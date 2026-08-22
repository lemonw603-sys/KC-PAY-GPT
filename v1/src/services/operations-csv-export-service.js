const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_PAGE_SIZE = 500;
const ABSOLUTE_MAX_PAGE_SIZE = 1000;
const UTF8_BOM = '\uFEFF';

const FORBIDDEN_FIELD_PATTERNS = [
  /(^|_)pan($|_)/i,
  /(^|_)cvv($|_)/i,
  /session/i,
  /api[_-]?key/i,
  /recharge[_-]?card[_-]?key/i,
  /card[_-]?number/i,
  /credential/i,
  /ciphertext/i,
  /secret/i,
  /token/i,
  /cdk[_-]?(code|plain|secret|value)?$/i
];

const DATASETS = Object.freeze({
  orders: {
    tableAlias: 'o',
    cursorColumn: 'o.created_at',
    idColumn: 'o.id',
    from: `orders o`,
    defaultColumns: ['publicNo', 'status', 'planType', 'amount', 'currency', 'rechargeOrderNo', 'createdAt', 'updatedAt'],
    columns: {
      id: { header: 'Order ID', sql: 'o.id' },
      publicNo: { header: 'Public No', sql: 'o.public_no' },
      status: { header: 'Status', sql: 'o.status' },
      planType: { header: 'Plan Type', sql: 'o.plan_type' },
      amount: { header: 'Amount', sql: 'o.actual_payment_amount' },
      currency: { header: 'Currency', sql: 'o.actual_payment_currency' },
      rechargeOrderNo: { header: 'Recharge Order No', sql: 'o.recharge_order_no' },
      routeResolutionStatus: { header: 'Route Resolution Status', sql: 'o.route_resolution_status' },
      createdAt: { header: 'Created At', sql: 'o.created_at' },
      updatedAt: { header: 'Updated At', sql: 'o.updated_at' }
    }
  },
  cards: {
    tableAlias: 'c',
    cursorColumn: 'c.created_at',
    idColumn: 'c.id',
    from: `cards c`,
    defaultColumns: ['providerAccountId', 'externalCardId', 'last4', 'status', 'inventoryStatus', 'fundedAmount', 'currentBalance', 'currency', 'syncTier', 'lastSuccessfulSyncAt'],
    columns: {
      id: { header: 'Card ID', sql: 'c.id' },
      providerAccountId: { header: 'Provider Account ID', sql: 'c.provider_account_id' },
      externalCardId: { header: 'External Card ID', sql: 'c.external_card_id' },
      last4: { header: 'Last4', sql: 'c.last4' },
      status: { header: 'Status', sql: 'c.status' },
      inventoryStatus: { header: 'Inventory Status', sql: 'c.inventory_status' },
      intakeStatus: { header: 'Intake Status', sql: 'c.intake_status' },
      fundedAmount: { header: 'Funded Amount', sql: 'c.funded_amount' },
      currentBalance: { header: 'Current Balance', sql: 'c.current_balance' },
      currency: { header: 'Currency', sql: 'c.currency' },
      refundStatus: { header: 'Refund Status', sql: 'c.refund_status' },
      syncTier: { header: 'Sync Tier', sql: 'c.sync_tier' },
      nextSyncAt: { header: 'Next Sync At', sql: 'c.next_sync_at' },
      lastSuccessfulSyncAt: { header: 'Last Successful Sync At', sql: 'c.last_successful_sync_at' },
      createdAt: { header: 'Created At', sql: 'c.created_at' },
      updatedAt: { header: 'Updated At', sql: 'c.updated_at' }
    }
  },
  reconciliation_cases: {
    tableAlias: 'rc',
    cursorColumn: 'rc.detected_at',
    idColumn: 'rc.id',
    from: `reconciliation_cases rc LEFT JOIN orders o ON o.id = rc.order_id`,
    defaultColumns: ['id', 'caseType', 'status', 'severity', 'dedupeKey', 'publicNo', 'assignedTo', 'detectedAt', 'lastSeenAt', 'resolvedAt'],
    columns: {
      id: { header: 'Case ID', sql: 'rc.id' },
      caseType: { header: 'Case Type', sql: 'rc.case_type' },
      status: { header: 'Status', sql: 'rc.status' },
      severity: { header: 'Severity', sql: 'rc.severity' },
      dedupeKey: { header: 'Dedupe Key', sql: 'rc.dedupe_key' },
      publicNo: { header: 'Public No', sql: 'o.public_no' },
      assignedTo: { header: 'Assigned To', sql: 'rc.assigned_to' },
      detectedAt: { header: 'Detected At', sql: 'rc.detected_at' },
      resolvedAt: { header: 'Resolved At', sql: 'rc.resolved_at' },
      updatedAt: { header: 'Updated At', sql: 'rc.updated_at' },
      lastSeenAt: { header: 'Last Seen At', sql: 'rc.last_seen_at' }
    }
  },
  cdk_batches: {
    tableAlias: 'c',
    cursorColumn: 'MIN(c.created_at)',
    idColumn: 'c.batch_no',
    from: `cdks c LEFT JOIN cdk_batches cb ON BINARY cb.batch_no = BINARY c.batch_no`,
    where: `c.batch_no IS NOT NULL`,
    groupBy: 'c.batch_no',
    defaultColumns: ['batchNo', 'planType', 'totalCount', 'availableCount', 'revokedCount', 'createdAt'],
    columns: {
      batchNo: { header: 'Batch No', sql: 'c.batch_no' },
      planType: { header: 'Plan Type', sql: 'MIN(c.plan_type)' },
      totalCount: { header: 'Total Count', sql: 'COUNT(*)', aggregate: true },
      availableCount: { header: 'Available Count', sql: "SUM(c.status = 'AVAILABLE')", aggregate: true },
      revokedCount: { header: 'Revoked Count', sql: "SUM(c.status = 'REVOKED')", aggregate: true },
      createdAt: { header: 'Created At', sql: 'MIN(c.created_at)', aggregate: true }
    }
  },
  order_trace: {
    tableAlias: 'o',
    cursorColumn: 'o.created_at',
    idColumn: 'o.id',
    from: `orders o
      LEFT JOIN cdks cdk ON cdk.id = o.cdk_id
      LEFT JOIN cards card ON card.order_id = o.id`,
    defaultColumns: ['publicNo', 'cdkBatchNo', 'planType', 'customerEmail', 'status', 'createdAt', 'updatedAt', 'finishedAt', 'customerPaymentAmount', 'customerPaymentCurrency', 'customerPaidAt', 'rechargeAmount', 'rechargeCurrency', 'cardProviderAccountId', 'providerCardId', 'cardLast4', 'cardBalance', 'rechargeOrderNo', 'providerBusinessCode', 'providerOutcome', 'providerFinishedAt', 'failureCode', 'failureReason', 'subscriptionCancelled'],
    columns: {
      publicNo: { header: '订单查询码', sql: 'o.public_no' },
      cdkBatchNo: { header: 'CDK 批次', sql: 'cdk.batch_no' },
      planType: { header: '产品', sql: 'o.plan_type' },
      customerEmail: { header: '客户邮箱', sql: 'o.customer_email' },
      status: { header: '订单状态', sql: 'o.status' },
      createdAt: { header: '创建时间', sql: 'o.created_at' },
      updatedAt: { header: '更新时间', sql: 'o.updated_at' },
      finishedAt: { header: '完成时间', sql: 'o.finished_at' },
      customerPaymentAmount: { header: '客户付款金额', sql: '(SELECT p.amount FROM customer_payments p WHERE (p.order_id = o.id OR p.cdk_id = o.cdk_id) ORDER BY p.created_at DESC LIMIT 1)' },
      customerPaymentCurrency: { header: '客户付款币种', sql: '(SELECT p.currency FROM customer_payments p WHERE (p.order_id = o.id OR p.cdk_id = o.cdk_id) ORDER BY p.created_at DESC LIMIT 1)' },
      customerPaidAt: { header: '客户实际付款时间', sql: '(SELECT p.paid_at FROM customer_payments p WHERE (p.order_id = o.id OR p.cdk_id = o.cdk_id) ORDER BY p.created_at DESC LIMIT 1)' },
      rechargeAmount: { header: '订单充值金额', sql: 'o.actual_payment_amount' },
      rechargeCurrency: { header: '订单充值币种', sql: 'o.actual_payment_currency' },
      cardProviderAccountId: { header: '卡台账户 ID', sql: 'card.provider_account_id' },
      providerCardId: { header: '卡台卡 ID', sql: 'card.provider_card_id' },
      cardLast4: { header: '卡号后四位', sql: 'card.last4' },
      cardBalance: { header: '卡片当前余额', sql: 'card.current_balance' },
      rechargeOrderNo: { header: 'Provider 订单号', sql: 'o.recharge_order_no' },
      providerBusinessCode: { header: 'Provider 业务码', sql: '(SELECT pc.business_code FROM provider_calls pc WHERE pc.order_id = o.id ORDER BY pc.id DESC LIMIT 1)' },
      providerOutcome: { header: 'Provider 结果', sql: '(SELECT pc.outcome FROM provider_calls pc WHERE pc.order_id = o.id ORDER BY pc.id DESC LIMIT 1)' },
      providerFinishedAt: { header: 'Provider 完成时间', sql: '(SELECT pc.finished_at FROM provider_calls pc WHERE pc.order_id = o.id ORDER BY pc.id DESC LIMIT 1)' },
      failureCode: { header: '失败代码', sql: 'o.failure_code' },
      failureReason: { header: '失败原因', sql: 'o.failure_reason' },
      subscriptionCancelled: { header: '已取消自动续费', sql: 'o.subscription_cancelled' }
    }
  }
});

export class OperationsCsvExportError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'OperationsCsvExportError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function assertSafeFieldName(field) {
  if (FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(field))) {
    throw new OperationsCsvExportError('CSV field is not allowed in safe operations export', 'FORBIDDEN_CSV_FIELD', { field });
  }
}

function normalizeDataset(value) {
  const dataset = String(value || '').trim();
  if (!DATASETS[dataset]) {
    throw new OperationsCsvExportError('unknown CSV dataset', 'UNKNOWN_DATASET');
  }
  return DATASETS[dataset];
}

function normalizeColumns(dataset, requestedColumns) {
  const keys = requestedColumns == null ? dataset.defaultColumns : requestedColumns;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new OperationsCsvExportError('CSV columns must be a non-empty array', 'INVALID_COLUMNS');
  }
  return keys.map((key) => {
    const normalized = String(key || '').trim();
    assertSafeFieldName(normalized);
    const column = dataset.columns[normalized];
    if (!column) {
      throw new OperationsCsvExportError('CSV column is not in dataset allowlist', 'UNKNOWN_COLUMN', { column: normalized });
    }
    assertSafeFieldName(column.sql);
    return { key: normalized, ...column };
  });
}

function normalizeLimit(value, maxRows) {
  const limit = Number(value || maxRows);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxRows) {
    throw new OperationsCsvExportError('invalid CSV row limit', 'INVALID_LIMIT', { maxRows });
  }
  return limit;
}

function normalizePageSize(value) {
  const pageSize = Number(value || DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ABSOLUTE_MAX_PAGE_SIZE) {
    throw new OperationsCsvExportError('invalid CSV page size', 'INVALID_PAGE_SIZE');
  }
  return pageSize;
}

function encodeCursor(cursor) {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  if (typeof cursor === 'object') return cursor;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!parsed || parsed.value == null || parsed.id == null) throw new Error('bad cursor');
    return parsed;
  } catch {
    throw new OperationsCsvExportError('invalid CSV cursor', 'INVALID_CURSOR');
  }
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function neutralizeExcelFormula(value) {
  let text = String(value ?? '');
  if (!text) return text;
  const formulaProbe = text.replace(
    /^[\u0000-\u0020\u007F\u00A0\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F\u2060\u3000\uFEFF]*/u,
    ''
  );
  if (/^[=+\-@]/u.test(formulaProbe)) text = `'${text}`;
  return text;
}

export function escapeCsvCell(value) {
  const text = neutralizeExcelFormula(iso(value) ?? '');
  const escaped = String(text).replace(/"/g, '""');
  return /[",\r\n]/u.test(escaped) ? `"${escaped}"` : escaped;
}

export function rowsToCsv(rows, columns, { includeBom = false } = {}) {
  const header = columns.map((column) => escapeCsvCell(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column.key])).join(','));
  return `${includeBom ? UTF8_BOM : ''}${[header, ...body].join('\r\n')}\r\n`;
}

function buildClauses(dataset, filters = {}, cursor = null) {
  const whereConditions = [];
  const havingConditions = [];
  const whereValues = [];
  const havingValues = [];
  if (dataset.where) whereConditions.push(`(${dataset.where})`);
  for (const [key, value] of Object.entries(filters || {})) {
    if (value == null || value === '') continue;
    assertSafeFieldName(key);
    const column = dataset.columns[key];
    if (!column) throw new OperationsCsvExportError('filter column is not allowed', 'UNKNOWN_FILTER', { filter: key });
    assertSafeFieldName(column.sql);
    if (column.aggregate) {
      havingConditions.push(`${column.sql} = ?`);
      havingValues.push(value);
    } else {
      whereConditions.push(`${column.sql} = ?`);
      whereValues.push(value);
    }
  }
  if (cursor) {
    havingConditions.push(`(${dataset.cursorColumn} > ? OR (${dataset.cursorColumn} = ? AND ${dataset.idColumn} > ?))`);
    havingValues.push(cursor.value, cursor.value, cursor.id);
  }
  return {
    whereSql: whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '',
    groupBySql: dataset.groupBy ? `GROUP BY ${dataset.groupBy}` : '',
    havingSql: havingConditions.length ? `HAVING ${havingConditions.join(' AND ')}` : '',
    values: [...whereValues, ...havingValues]
  };
}

function mapRow(row, columns) {
  const mapped = {};
  for (const column of columns) mapped[column.key] = row[column.key];
  return mapped;
}

export function createOperationsCsvExportService({
  pool,
  maxRows = DEFAULT_MAX_ROWS,
  defaultPageSize = DEFAULT_PAGE_SIZE
} = {}) {
  if (!pool?.query) throw new Error('Operations CSV export service requires a MySQL pool');
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > DEFAULT_MAX_ROWS) {
    throw new OperationsCsvExportError('invalid configured max rows', 'INVALID_MAX_ROWS');
  }

  async function exportCsv(input = {}) {
    const dataset = normalizeDataset(input.dataset || 'orders');
    const columns = normalizeColumns(dataset, input.columns);
    const limit = normalizeLimit(input.limit, maxRows);
    const pageSize = Math.min(limit, normalizePageSize(input.pageSize || defaultPageSize));
    let cursor = decodeCursor(input.cursor);
    const rows = [];
    let lastCursor = cursor;

    while (rows.length < limit) {
      const batchSize = Math.min(pageSize, limit - rows.length);
      const clauses = buildClauses(dataset, input.filters, cursor);
      const selectList = [
        ...columns.map((column) => `${column.sql} AS ${column.key}`),
        `${dataset.cursorColumn} AS __cursor_value`,
        `${dataset.idColumn} AS __cursor_id`
      ].join(', ');
      const [batch] = await pool.query(
        `SELECT ${selectList}
         FROM ${dataset.from}
         ${clauses.whereSql}
         ${clauses.groupBySql}
         ${clauses.havingSql}
         ORDER BY ${dataset.cursorColumn} ASC, ${dataset.idColumn} ASC
         LIMIT ?`,
        [...clauses.values, batchSize]
      );
      if (!batch.length) break;
      for (const row of batch) rows.push(mapRow(row, columns));
      const tail = batch[batch.length - 1];
      lastCursor = { value: iso(tail.__cursor_value), id: tail.__cursor_id };
      cursor = lastCursor;
      if (batch.length < batchSize) break;
    }

    return {
      dataset: input.dataset || 'orders',
      rowCount: rows.length,
      truncated: rows.length >= limit,
      nextCursor: encodeCursor(lastCursor),
      contentType: 'text/csv; charset=utf-8',
      csv: rowsToCsv(rows, columns, { includeBom: Boolean(input.includeBom) })
    };
  }

  return { exportCsv };
}
