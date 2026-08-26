'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    AppendOnlyWal,
    recoverRunState,
    GENESIS_HASH
} = require('../browser-poc/experiment-wal');
const { ContractError } = require('../browser-poc/experiment-core');

const tempDirs = [];

function walFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-wal-test-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'runs.wal.jsonl');
    return { dir, filePath, wal: new AppendOnlyWal({ filePath }) };
}

function expectCode(fn, code) {
    try {
        fn();
        throw new Error(`expected ${code}`);
    } catch (error) {
        expect(error).toBeInstanceOf(ContractError);
        expect(error.code).toBe(code);
    }
}

afterEach(() => {
    while (tempDirs.length) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});

describe('append-only browser experiment WAL', () => {
    it('writes a 0600 hash chain and verifies it after restart', () => {
        const { filePath, wal } = walFixture();
        const first = wal.append({
            runId: 'run-1',
            eventType: 'RUN_STARTED',
            eventId: 'event-1',
            occurredAt: '2026-08-22T00:00:00.000Z',
            payload: { scope: 'CHECKOUT_MUTATING', manifestHash: 'manifest-hash' }
        });
        const second = wal.append({
            runId: 'run-1',
            eventType: 'ROUTE_SELECTED',
            eventId: 'event-2',
            occurredAt: '2026-08-22T00:00:01.000Z',
            payload: { route: 'HOSTED_SPLIT_CONTEXT' }
        }, { expectedHeadHash: first.hash });

        expect(first.prevHash).toBe(GENESIS_HASH);
        expect(second.prevHash).toBe(first.hash);
        expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
        const restarted = new AppendOnlyWal({ filePath });
        expect(restarted.readAll()).toHaveLength(2);
        expect(restarted.head()).toEqual({ sequence: 2, hash: second.hash });
    });

    it('detects a modified payload in the middle of the chain', () => {
        const { filePath, wal } = walFixture();
        wal.append({ runId: 'run-1', eventType: 'RUN_STARTED', payload: { scope: 'AUTH_READ_ONLY' } });
        wal.append({ runId: 'run-1', eventType: 'ROUTE_SELECTED', payload: { route: 'CHAMPION' } });
        const lines = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
        const first = JSON.parse(lines[0]);
        first.payload.scope = 'CHECKOUT_MUTATING';
        lines[0] = JSON.stringify(first);
        fs.writeFileSync(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
        expectCode(() => wal.readAll(), 'WAL_HASH_MISMATCH');
    });

    it('invalidates the fast append cache when the WAL changes outside the writer', () => {
        const { filePath, wal } = walFixture();
        wal.append({ runId: 'run-1', eventType: 'RUN_STARTED', payload: { scope: 'AUTH_READ_ONLY' } });
        const event = JSON.parse(fs.readFileSync(filePath, 'utf8').trim());
        event.payload.scope = 'CHECKOUT_MUTATING';
        fs.writeFileSync(filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
        expectCode(() => wal.append({
            runId: 'run-1', eventType: 'ROUTE_SELECTED', payload: { route: 'CHAMPION' }
        }), 'WAL_HASH_MISMATCH');
    });

    it('deep-freezes cached events so callers cannot poison the verified head', () => {
        const { wal } = walFixture();
        wal.append({
            runId: 'run-cache',
            eventType: 'RUN_STARTED',
            payload: { nested: { state: 'SAFE' } }
        });
        const cached = wal.readAll({ useCache: true });
        expect(Object.isFrozen(cached)).toBe(true);
        expect(Object.isFrozen(cached[0].payload.nested)).toBe(true);
        expect(() => {
            cached[0].payload.nested.state = 'POISONED';
        }).toThrow(TypeError);
        expect(() => cached.push({})).toThrow(TypeError);
        expect(wal.readAll({ useCache: true })[0].payload.nested.state).toBe('SAFE');
    });

    it('detects a truncated final record instead of ignoring it', () => {
        const { filePath, wal } = walFixture();
        wal.append({ runId: 'run-1', eventType: 'RUN_STARTED', payload: {} });
        const content = fs.readFileSync(filePath, 'utf8');
        fs.writeFileSync(filePath, content.slice(0, -5), { mode: 0o600 });
        expectCode(() => wal.readAll(), 'WAL_TRUNCATED');
    });

    it('rejects stale optimistic heads and duplicate event IDs', () => {
        const { wal } = walFixture();
        wal.append({
            runId: 'run-1',
            eventType: 'RUN_STARTED',
            eventId: 'stable-event-id',
            payload: {}
        });
        expectCode(() => wal.append({
            runId: 'run-1',
            eventType: 'ROUTE_SELECTED',
            payload: { route: 'CHAMPION' }
        }, { expectedHeadHash: GENESIS_HASH }), 'WAL_HEAD_CONFLICT');
        expectCode(() => wal.append({
            runId: 'run-1',
            eventType: 'ROUTE_SELECTED',
            eventId: 'stable-event-id',
            payload: { route: 'CHAMPION' }
        }), 'WAL_DUPLICATE_EVENT_ID');
    });

    it('fails closed when another writer lock exists', () => {
        const { filePath, wal } = walFixture();
        fs.writeFileSync(`${filePath}.lock`, 'other-writer\n', { mode: 0o600 });
        expectCode(() => wal.append({
            runId: 'run-1',
            eventType: 'RUN_STARTED',
            payload: {}
        }), 'WAL_BUSY');
    });

    it.each([
        [{ sessionToken: 'not-allowed' }, 'WAL_SENSITIVE_FIELD'],
        [{ navigation_url: 'not-allowed' }, 'WAL_SENSITIVE_FIELD'],
        [{ note: 'https://pay.openai.com/c/pay/cs_test_secret#fid-secret' }, 'WAL_SENSITIVE_VALUE'],
        [{ note: '__Secure-authjs.session-token=secret' }, 'WAL_SENSITIVE_VALUE']
    ])('rejects sensitive payload %#', (payload, code) => {
        const { wal } = walFixture();
        expectCode(() => wal.append({
            runId: 'run-1',
            eventType: 'RUN_STARTED',
            payload
        }), code);
    });

    it('allows opaque refs and hashes required for recovery', () => {
        const { wal } = walFixture();
        expect(() => wal.append({
            runId: 'run-1',
            eventType: 'CHECKOUT_ATTACHED',
            payload: {
                checkoutArtifact: {
                    secretRef: 'vault://artifact-1',
                    urlHash: 'url-hash',
                    checkoutHash: 'checkout-hash'
                }
            }
        })).not.toThrow();
    });

    it('recovers PAYMENT_UNKNOWN as reconcile-only after process restart', () => {
        const { filePath, wal } = walFixture();
        wal.append({ runId: 'run-unknown', eventType: 'RUN_STARTED', payload: {} });
        wal.append({
            runId: 'run-unknown',
            eventType: 'ROUTE_SELECTED',
            payload: { route: 'HOSTED_SPLIT_CONTEXT' }
        });
        wal.append({
            runId: 'run-unknown',
            eventType: 'CHECKOUT_ATTACHED',
            payload: {
                checkoutArtifact: {
                    secretRef: 'vault://artifact-unknown',
                    urlHash: 'url-hash',
                    checkoutHash: 'checkout-hash'
                }
            }
        });
        wal.append({
            runId: 'run-unknown',
            eventType: 'PAYMENT_STATE_CHANGED',
            payload: { paymentState: 'PAYMENT_UNKNOWN' }
        });

        const restarted = new AppendOnlyWal({ filePath });
        expect(recoverRunState(restarted.readAll(), 'run-unknown')).toMatchObject({
            route: 'HOSTED_SPLIT_CONTEXT',
            paymentState: 'PAYMENT_UNKNOWN',
            mayCreateCheckout: false,
            maySubmitPayment: false,
            recoveryAction: 'RECONCILE_ONLY'
        });
    });

    it('fails closed on an event from a newer unknown state machine', () => {
        const { wal } = walFixture();
        wal.append({ runId: 'run-newer', eventType: 'RUN_STARTED', payload: {} });
        wal.append({ runId: 'run-newer', eventType: 'FUTURE_EVENT', payload: { version: 2 } });
        expect(recoverRunState(wal.readAll(), 'run-newer')).toMatchObject({
            status: 'REVIEW_REQUIRED',
            mayCreateCheckout: false,
            maySubmitPayment: false,
            recoveryAction: 'UNKNOWN_EVENT_REVIEW_REQUIRED',
            unknownEvents: ['FUTURE_EVENT']
        });
    });
});
