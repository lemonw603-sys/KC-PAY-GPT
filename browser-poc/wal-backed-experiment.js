'use strict';

const crypto = require('node:crypto');
const { ContractError, ExperimentOrchestrator } = require('./experiment-core');
const { recoverRunState } = require('./experiment-wal');

const SAFE_OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function operationEventId(runId, operationId, phase) {
    const digest = crypto.createHash('sha256')
        .update(`${runId}\0${operationId}\0${phase}`)
        .digest('hex');
    return `operation_${digest}`;
}

class WalBackedExperimentCoordinator {
    constructor({ wal, orchestrator = new ExperimentOrchestrator(), faultInjector = null } = {}) {
        if (!wal || typeof wal.append !== 'function' || typeof wal.readAll !== 'function') {
            throw new ContractError('WAL_REQUIRED');
        }
        this.wal = wal;
        this.orchestrator = orchestrator;
        this.faultInjector = faultInjector;
    }

    recover(runId) {
        return recoverRunState(this.wal.readAll({ useCache: true }), runId);
    }

    beginRun(input, { operationId = `${input?.runId}:begin`, now = Date.now() } = {}) {
        const runId = input?.runId;
        return this.#durableMutation({
            runId,
            operationId,
            operationType: 'RUN_BEGIN',
            eventType: 'RUN_STARTED',
            action: () => this.orchestrator.beginRun(input, now),
            payload: (evidence) => ({
                scope: evidence.scope,
                laneId: evidence.laneId,
                manifestHash: evidence.manifest.manifestSha256
            })
        });
    }

    selectRoute(input, { operationId = `${input?.runId}:route` } = {}) {
        return this.#durableMutation({
            runId: input?.runId,
            operationId,
            operationType: 'ROUTE_SELECT',
            eventType: 'ROUTE_SELECTED',
            action: () => this.orchestrator.selectRoute(input),
            payload: (route) => ({ route: route.selected, reason: route.reason })
        });
    }

    attachCheckout(input, { operationId = `${input?.runId}:checkout`, now = Date.now() } = {}) {
        return this.#durableMutation({
            runId: input?.runId,
            operationId,
            operationType: 'CHECKOUT_ATTACH',
            eventType: 'CHECKOUT_ATTACHED',
            action: () => this.orchestrator.attachCheckout({ ...input, now }),
            payload: (artifact) => ({
                checkoutArtifact: {
                    artifactId: artifact.artifactId,
                    secretRef: artifact.secretRef,
                    kind: artifact.kind,
                    urlHash: artifact.urlHash,
                    checkoutHash: artifact.checkoutHash
                }
            })
        });
    }

    submitPayment({ runId, submit }, { operationId = `${runId}:payment-submit` } = {}) {
        this.#assertOperationInput(runId, operationId);
        const prior = this.#priorOperation(runId, operationId);
        if (prior.completed) return this.#idempotentResult(runId);
        if (prior.pending) throw new ContractError('OPERATION_OUTCOME_UNKNOWN');

        this.#appendPrepared(runId, operationId, 'PAYMENT_SUBMIT');
        this.#fault('AFTER_PREPARE', 'PAYMENT_SUBMIT', operationId);
        this.orchestrator.markPaymentState({ runId, paymentState: 'PAYMENT_SUBMITTING' });
        this.wal.append({
            runId,
            eventType: 'PAYMENT_STATE_CHANGED',
            eventId: operationEventId(runId, operationId, 'submitting'),
            payload: {
                operationId,
                operationType: 'PAYMENT_SUBMIT',
                operationCompleted: false,
                paymentState: 'PAYMENT_SUBMITTING'
            }
        });
        this.#fault('BEFORE_EXTERNAL_ACTION', 'PAYMENT_SUBMIT', operationId);

        let result;
        try {
            result = submit();
        } catch (error) {
            result = { status: 'PAYMENT_UNKNOWN', errorCode: error?.code || 'EXTERNAL_RESULT_UNKNOWN' };
        }
        this.#fault('AFTER_EXTERNAL_ACTION', 'PAYMENT_SUBMIT', operationId);
        const paymentState = typeof result?.status === 'string' && result.status
            ? result.status
            : 'PAYMENT_UNKNOWN';
        this.orchestrator.markPaymentState({ runId, paymentState });
        this.wal.append({
            runId,
            eventType: 'PAYMENT_STATE_CHANGED',
            eventId: operationEventId(runId, operationId, 'completed'),
            payload: {
                operationId,
                operationType: 'PAYMENT_SUBMIT',
                operationCompleted: true,
                paymentState,
                authorizationRef: result?.authorizationRef || null
            }
        });
        this.#fault('AFTER_COMMIT', 'PAYMENT_SUBMIT', operationId);
        return Object.freeze({ result, recovered: this.recover(runId), idempotentReplay: false });
    }

    recordPaymentState({ runId, paymentState }, { operationId } = {}) {
        return this.#durableMutation({
            runId,
            operationId: operationId || `${runId}:payment:${paymentState}`,
            operationType: 'PAYMENT_OBSERVE',
            eventType: 'PAYMENT_STATE_CHANGED',
            action: () => this.orchestrator.markPaymentState({ runId, paymentState }),
            payload: () => ({ paymentState })
        });
    }

    requestTakeover({ runId, humanOwnerId }, options = {}) {
        return this.#controlMutation({
            runId,
            operationId: options.operationId || `${runId}:control:request`,
            operationType: 'CONTROL_REQUEST',
            action: () => this.orchestrator.control.requestTakeover({ runId, humanOwnerId })
        });
    }

    freezeControl({ runId, automationOwnerId }, options = {}) {
        return this.#controlMutation({
            runId,
            operationId: options.operationId || `${runId}:control:freeze`,
            operationType: 'CONTROL_FREEZE',
            action: () => this.orchestrator.control.freeze({ runId, automationOwnerId })
        });
    }

    transferControl({ runId, humanOwnerId }, options = {}) {
        return this.#controlMutation({
            runId,
            operationId: options.operationId || `${runId}:control:transfer`,
            operationType: 'CONTROL_TRANSFER',
            action: () => this.orchestrator.control.transfer({ runId, humanOwnerId })
        });
    }

    releaseControl({ runId, humanOwnerId }, options = {}) {
        return this.#controlMutation({
            runId,
            operationId: options.operationId || `${runId}:control:release`,
            operationType: 'CONTROL_RELEASE',
            action: () => this.orchestrator.control.release({ runId, humanOwnerId })
        });
    }

    #controlMutation({ runId, operationId, operationType, action }) {
        return this.#durableMutation({
            runId,
            operationId,
            operationType,
            eventType: 'CONTROL_STATE_CHANGED',
            action,
            payload: (control) => ({ controlState: control.state })
        });
    }

    #durableMutation({ runId, operationId, operationType, eventType, action, payload }) {
        this.#assertOperationInput(runId, operationId);
        const prior = this.#priorOperation(runId, operationId);
        if (prior.completed) return this.#idempotentResult(runId);
        if (prior.pending) throw new ContractError('OPERATION_OUTCOME_UNKNOWN');

        this.#appendPrepared(runId, operationId, operationType);
        this.#fault('AFTER_PREPARE', operationType, operationId);
        let result;
        try {
            result = action();
        } catch (error) {
            this.wal.append({
                runId,
                eventType: 'OPERATION_ABORTED',
                eventId: operationEventId(runId, operationId, 'aborted'),
                payload: {
                    operationId,
                    operationType,
                    operationCompleted: true,
                    reasonCode: error?.code || 'ACTION_REJECTED'
                }
            });
            throw error;
        }
        this.#fault('AFTER_APPLY', operationType, operationId);
        this.wal.append({
            runId,
            eventType,
            eventId: operationEventId(runId, operationId, 'completed'),
            payload: {
                operationId,
                operationType,
                operationCompleted: true,
                ...payload(result)
            }
        });
        this.#fault('AFTER_COMMIT', operationType, operationId);
        return Object.freeze({ result, recovered: this.recover(runId), idempotentReplay: false });
    }

    #appendPrepared(runId, operationId, operationType) {
        this.wal.append({
            runId,
            eventType: 'OPERATION_PREPARED',
            eventId: operationEventId(runId, operationId, 'prepared'),
            payload: { operationId, operationType }
        });
    }

    #priorOperation(runId, operationId) {
        const events = this.wal.readAll({ useCache: true }).filter((event) => event.runId === runId);
        const prepared = events.some((event) => event.eventType === 'OPERATION_PREPARED'
            && event.payload.operationId === operationId);
        const completed = events.some((event) => event.payload?.operationId === operationId
            && event.payload.operationCompleted === true);
        return { completed, pending: prepared && !completed };
    }

    #idempotentResult(runId) {
        return Object.freeze({ result: null, recovered: this.recover(runId), idempotentReplay: true });
    }

    #assertOperationInput(runId, operationId) {
        if (typeof runId !== 'string' || !runId) throw new ContractError('WAL_RUN_ID_REQUIRED');
        if (typeof operationId !== 'string' || !SAFE_OPERATION_ID.test(operationId)) {
            throw new ContractError('OPERATION_ID_INVALID');
        }
    }

    #fault(point, operationType, operationId) {
        if (this.faultInjector) this.faultInjector({ point, operationType, operationId });
    }
}

module.exports = { WalBackedExperimentCoordinator, operationEventId };
