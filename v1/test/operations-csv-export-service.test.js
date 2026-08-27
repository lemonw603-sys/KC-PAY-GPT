import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOperationsCsvExportService,
  escapeCsvCell,
  rowsToCsv
} from '../src/services/operations-csv-export-service.js';

function scriptedPool(responses) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error(`unexpected query: ${sql}`);
      return response;
    }
  };
}

test('escapes RFC4180 cells and neutralizes Excel formula injection', () => {
  assert.equal(escapeCsvCell('plain'), 'plain');
  assert.equal(escapeCsvCell('a,b'), '"a,b"');
  assert.equal(escapeCsvCell('a"b'), '"a""b"');
  assert.equal(escapeCsvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(escapeCsvCell('=1+1'), "'=1+1");
  assert.equal(escapeCsvCell('+SUM(A1:A2)'), "'+SUM(A1:A2)");
  assert.equal(escapeCsvCell('-10'), "'-10");
  assert.equal(escapeCsvCell('@cmd'), "'@cmd");
  assert.equal(escapeCsvCell('\t=cmd'), "'\t=cmd");
  assert.equal(escapeCsvCell(' =cmd'), "' =cmd");
  assert.equal(escapeCsvCell('\u00A0=cmd'), "'\u00A0=cmd");
  assert.equal(escapeCsvCell('\uFEFF=cmd'), "'\uFEFF=cmd");
});

test('renders CSV with CRLF and optional UTF-8 BOM', () => {
  const csv = rowsToCsv([
    { publicNo: 'PJV2-1', status: '=OPEN' },
    { publicNo: 'PJV2,2', status: 'DONE' }
  ], [
    { key: 'publicNo', header: 'Public No' },
    { key: 'status', header: 'Status' }
  ], { includeBom: true });

  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /^\uFEFFPublic No,Status\r\n/);
  assert.match(csv, /PJV2-1,'=OPEN\r\n/);
  assert.match(csv, /"PJV2,2",DONE\r\n$/);
});

test('exports safe operational fields with SQL cursor pagination and row limit', async () => {
  const firstCursorAt = new Date('2026-08-20T12:00:00.000Z');
  const secondCursorAt = new Date('2026-08-20T12:01:00.000Z');
  const thirdCursorAt = new Date('2026-08-20T12:02:00.000Z');
  const pool = scriptedPool([
    [[
      { publicNo: 'PJV2-ORDER-0001', status: 'CARD_READY', __cursor_value: firstCursorAt, __cursor_id: 'order-1' },
      { publicNo: '=PJV2-ORDER-0002', status: 'SUBMIT_UNKNOWN', __cursor_value: secondCursorAt, __cursor_id: 'order-2' }
    ], []],
    [[
      { publicNo: 'PJV2-ORDER-0003', status: 'RECHARGE_SUCCESS', __cursor_value: thirdCursorAt, __cursor_id: 'order-3' }
    ], []]
  ]);
  const service = createOperationsCsvExportService({ pool, maxRows: 10_000 });
  const result = await service.exportCsv({
    dataset: 'orders',
    columns: ['publicNo', 'status'],
    filters: { status: 'CARD_READY' },
    limit: 3,
    pageSize: 2
  });

  assert.equal(result.rowCount, 3);
  assert.equal(result.truncated, true);
  assert.match(result.csv, /^Public No,Status\r\n/);
  assert.match(result.csv, /PJV2-ORDER-0001,CARD_READY\r\n/);
  assert.match(result.csv, /'=PJV2-ORDER-0002,SUBMIT_UNKNOWN\r\n/);
  assert.equal(pool.queries.length, 2);
  assert.doesNotMatch(pool.queries.map((entry) => entry.sql).join('\n'), /OFFSET/i);
  assert.match(pool.queries[0].sql, /ORDER BY o\.created_at ASC, o\.id ASC LIMIT \?/);
  assert.deepEqual(pool.queries[0].values, ['CARD_READY', 2]);
  assert.match(pool.queries[1].sql, /o\.created_at > \? OR \(o\.created_at = \? AND o\.id > \?\)/);
  assert.deepEqual(pool.queries[1].values, ['CARD_READY', '2026-08-20T12:01:00.000Z', '2026-08-20T12:01:00.000Z', 'order-2', 1]);
  const decodedCursor = JSON.parse(Buffer.from(result.nextCursor, 'base64url').toString('utf8'));
  assert.deepEqual(decodedCursor, { value: '2026-08-20T12:02:00.000Z', id: 'order-3' });
});

test('rejects explicit sensitive fields before querying MySQL', async () => {
  const pool = scriptedPool([]);
  const service = createOperationsCsvExportService({ pool });
  for (const forbidden of ['cardNumber', 'cvv', 'pan_hmac', 'session', 'apiKey', 'recharge_card_key', 'cdkCode', 'credentialsCiphertext']) {
    await assert.rejects(
      service.exportCsv({ dataset: 'orders', columns: ['publicNo', forbidden] }),
      (error) => error.code === 'FORBIDDEN_CSV_FIELD' || error.code === 'UNKNOWN_COLUMN'
    );
  }
  assert.equal(pool.queries.length, 0);
});

test('default card CSV does not select PAN, CVV, session, API key, CDK plaintext or recharge_card_key', async () => {
  const pool = scriptedPool([
    [[{
      providerAccountId: 'acct-1', externalCardId: 'ext-1', last4: '4242', status: 'active',
      inventoryStatus: 'AVAILABLE', fundedAmount: '5.00', currentBalance: '5.00', currency: 'USD',
      syncTier: 'INVENTORY', lastSuccessfulSyncAt: new Date('2026-08-20T12:00:00.000Z'),
      __cursor_value: new Date('2026-08-20T12:00:00.000Z'), __cursor_id: 'card-1'
    }], []]
  ]);
  const service = createOperationsCsvExportService({ pool });
  const result = await service.exportCsv({ dataset: 'cards', limit: 1 });

  assert.equal(result.rowCount, 1);
  const allSql = pool.queries.map((entry) => entry.sql).join('\n');
  assert.doesNotMatch(allSql, /pan|cvv|session|api[_-]?key|cdk|recharge_card_key|card_number|credential|ciphertext|secret|token/i);
  assert.match(result.csv, /Provider Account ID,External Card ID,Last4,Status/);
  assert.match(result.csv, /acct-1,ext-1,4242,active/);
});

test('uses dataset allowlists for reconciliation cases and CDK batch summaries only', async () => {
  const pool = scriptedPool([
    [[{
      id: 'case-1', caseType: 'PAYMENT_MISMATCH', status: 'OPEN', severity: 'warning',
      dedupeKey: 'order:1:payment', publicNo: 'PJV2-ORDER-0001', assignedTo: null,
      detectedAt: new Date('2026-08-20T12:00:00.000Z'), resolvedAt: null,
      lastSeenAt: new Date('2026-08-20T12:00:00.000Z'), __cursor_value: new Date('2026-08-20T12:00:00.000Z'), __cursor_id: 'case-1'
    }], []],
    [[{
      batchNo: 'BATCH-1', planType: 'plus', totalCount: 50, availableCount: 49,
      revokedCount: 1, createdAt: new Date('2026-08-20T12:00:00.000Z'),
      __cursor_value: new Date('2026-08-20T12:00:00.000Z'), __cursor_id: 'BATCH-1'
    }], []]
  ]);
  const service = createOperationsCsvExportService({ pool });

  const cases = await service.exportCsv({ dataset: 'reconciliation_cases', limit: 1 });
  const batches = await service.exportCsv({ dataset: 'cdk_batches', limit: 1 });
  assert.match(cases.csv, /Case ID,Case Type,Status,Severity,Dedupe Key/);
  assert.match(batches.csv, /Batch No,Plan Type,Total Count,Available Count,Revoked Count/);
  const allSql = pool.queries.map((entry) => entry.sql).join('\n');
  assert.doesNotMatch(allSql, /evidence_json|resolution_note|cdk_code|code_plain|recharge_card_key|session|api_key/i);
});

test('enforces maximum row limit and cursor validation', async () => {
  const service = createOperationsCsvExportService({ pool: scriptedPool([]), maxRows: 100 });
  await assert.rejects(
    service.exportCsv({ dataset: 'orders', limit: 101 }),
    (error) => error.code === 'INVALID_LIMIT'
  );
  await assert.rejects(
    service.exportCsv({ dataset: 'orders', cursor: 'not-base64-json' }),
    (error) => error.code === 'INVALID_CURSOR'
  );
});

test('exports the bounded order trace dataset without sensitive authority fields', async () => {
  const pool = scriptedPool([[[{
    publicNo: 'PJV1-TRACE', cdkBatchNo: 'B-1', planType: 'plus', customerEmail: 'x@example.com',
    status: 'RECHARGE_FAILED', createdAt: new Date('2026-08-20T12:00:00.000Z'), updatedAt: new Date('2026-08-20T12:01:00.000Z'),
    finishedAt: new Date('2026-08-20T12:01:00.000Z'), customerPaymentAmount: null, customerPaymentCurrency: null,
    customerPaidAt: null, rechargeAmount: null, rechargeCurrency: null, cardProviderAccountId: 'acct',
    providerCardId: '612', cardLast4: '1666', cardBalance: '16.00', rechargeOrderNo: null,
    providerBusinessCode: '40030', providerOutcome: 'DEFINITE_FAILURE', providerFinishedAt: new Date('2026-08-20T12:01:00.000Z'),
    failureCode: null, failureReason: null, subscriptionCancelled: 0,
    __cursor_value: new Date('2026-08-20T12:00:00.000Z'), __cursor_id: 'order-1'
  }], []]]);
  const service = createOperationsCsvExportService({ pool });
  const result = await service.exportCsv({ dataset: 'order_trace', limit: 1 });
  assert.equal(result.rowCount, 1);
  assert.match(result.csv, /订单查询码,CDK 批次,产品,客户邮箱/);
  assert.match(result.csv, /PJV1-TRACE/);
  assert.doesNotMatch(pool.queries[0].sql, /card_number_ciphertext|card_credentials_ciphertext|session_ciphertext|cdk.*ciphertext/i);
});
