import { createHash } from 'node:crypto';

// Narrow recovery adapter for reviewed DDL in 055–058.
// SQL remains authoritative; fingerprints prevent an edited file silently using old checks.
const contracts = {
  '055_cdk_issuance_and_expiry.sql': {
    hash: 'c03d8156b5007f6a2f5d39b354d39c556f312bf282cce973666f8a40a186ad38',
    columns: [
      ['cdks', 'issued_at', 'timestamp(3)', true, null],
      ['cdks', 'issued_note', 'varchar(200)', true, null],
      ['cdks', 'expires_at', 'timestamp(3)', true, null]
    ], indexes: [['cdks', 'idx_cdks_status_issued', ['status', 'issued_at']]]
  },
  '056_cdk_sales_metadata.sql': {
    hash: '686193d5e1038b14b22bf34142f353e3f2fc14d37e53c75f441c68ec3ddfd96e',
    columns: [
      ['cdk_batches', 'channel_note', 'varchar(200)', true, null],
      ['cdk_batches', 'sale_amount', 'decimal(12,2)', true, null],
      ['cdk_batches', 'sale_currency', 'char(3)', true, null],
      ['cdk_batches', 'issued_at', 'timestamp(3)', true, null],
      ['cdk_batches', 'generation_fingerprint', 'char(64)', true, null],
      ['cdks', 'issuance_kind', 'varchar(16)', false, 'LEGACY'],
      ['cdks', 'admin_updated_at', 'timestamp(3)', true, null]
    ], indexes: [['cdks', 'idx_cdks_kind_status', ['issuance_kind', 'status']]]
  },
  '057_alert_incident_version.sql': {
    hash: '557a1ed4a1f2b8d8b939c07cfd0cc6890ffb948fccddaff49ef282fa638625c1',
    columns: [
      ['operator_alerts', 'incident_version', 'int unsigned', false, '1'],
      ['alert_notifications', 'incident_version', 'int unsigned', false, '1']
    ], indexes: [], trigger: 'operator_alert_incident_version_before_update'
  },
  '058_app_settings_report_capacity.sql': {
    hash: 'f4e712c25c1b58dd2ed625dc434826d6bc4620d0cfeddb8caa470d002775f481',
    columns: [], indexes: [],
    widen: ['app_settings', 'setting_value', 'varchar(255)', 'mediumtext', false, null]
  }
};

export class MigrationGuardError extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.code = code; }
}
const identifier = value => '`' + value.replaceAll('`', '``') + '`';
const normalized = value => String(value).replaceAll('`', '').replace(/\s+/g, ' ').trim();
const mismatch = label => { throw new MigrationGuardError('MIGRATION_SCHEMA_MISMATCH', label); };

export function step6MigrationPlan(file, sql) {
  const contract = contracts[file];
  if (!contract) return null;
  if (createHash('sha256').update(sql).digest('hex') !== contract.hash) {
    throw new MigrationGuardError('MIGRATION_SOURCE_MISMATCH', `${file}: review DDL and its recovery contract together`);
  }
  const steps = contract.columns.map(([table, name, type, nullable, defaultValue]) => {
    const declaration = sql.match(new RegExp(`ADD COLUMN ${name} ([^\\n]+)`))?.[1]?.replace(/[,;]\s*$/, '');
    if (!declaration) mismatch(`${file}.${name}: missing canonical declaration`);
    return { kind: 'column', table, name, type, nullable, defaultValue,
      sql: `ALTER TABLE ${identifier(table)} ADD COLUMN ${identifier(name)} ${declaration}` };
  });
  if (contract.widen) {
    const [table, name, fromType, type, nullable, defaultValue] = contract.widen;
    const canonical = `ALTER TABLE ${table} MODIFY COLUMN ${name} MEDIUMTEXT NOT NULL;`;
    if (!sql.includes(canonical)) mismatch(`${file}: widening DDL missing`);
    steps.push({ kind: 'widen-column', table, name, fromType, type, nullable, defaultValue, sql: canonical });
  }
  for (const [table, name, columns] of contract.indexes) {
    steps.push({ kind: 'index', table, name, columns,
      sql: `ALTER TABLE ${identifier(table)} ADD KEY ${identifier(name)} (${columns.map(identifier).join(', ')})` });
  }
  if (contract.trigger) {
    const triggerSql = sql.slice(sql.indexOf('CREATE TRIGGER')).trim();
    steps.push({ kind: 'trigger', table: 'operator_alerts', name: contract.trigger,
      body: triggerSql.match(/FOR EACH ROW\s+([\s\S]*);\s*$/)?.[1], sql: triggerSql });
  }
  return steps;
}

async function inspect(connection, step) {
  if (step.kind === 'column' || step.kind === 'widen-column') {
    const [[row]] = await connection.query(`SELECT c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, c.EXTRA, c.GENERATION_EXPRESSION,
        c.COLLATION_NAME, t.TABLE_COLLATION
      FROM information_schema.COLUMNS c JOIN information_schema.TABLES t
        ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
      WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=? AND c.COLUMN_NAME=?`, [step.table, step.name]);
    if (!row) return false;
    const original = step.kind === 'widen-column' && row.COLUMN_TYPE === step.fromType;
    if ((!original && row.COLUMN_TYPE !== step.type) || row.IS_NULLABLE !== (step.nullable ? 'YES' : 'NO')
      || row.COLUMN_DEFAULT !== step.defaultValue || row.EXTRA !== '' || row.GENERATION_EXPRESSION !== ''
      || (row.COLLATION_NAME !== null && row.COLLATION_NAME !== row.TABLE_COLLATION)) mismatch(`${step.table}.${step.name}`);
    return !original;
  }
  if (step.kind === 'index') {
    const [rows] = await connection.query(`SELECT COLUMN_NAME, NON_UNIQUE, SUB_PART, EXPRESSION, INDEX_TYPE, IS_VISIBLE
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX`, [step.table, step.name]);
    if (!rows.length) return false;
    if (rows.length !== step.columns.length || rows.some((r, i) => r.COLUMN_NAME !== step.columns[i]
      || Number(r.NON_UNIQUE) !== 1 || r.SUB_PART !== null || r.EXPRESSION !== null || r.INDEX_TYPE !== 'BTREE' || r.IS_VISIBLE !== 'YES')) mismatch(`${step.table}.${step.name}`);
    return true;
  }
  const [[row]] = await connection.query(`SELECT EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT, ACTION_ORIENTATION
    FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?`, [step.name]);
  if (!row) return false;
  if (row.EVENT_OBJECT_TABLE !== step.table || row.ACTION_TIMING !== 'BEFORE' || row.EVENT_MANIPULATION !== 'UPDATE'
    || row.ACTION_ORIENTATION !== 'ROW' || normalized(row.ACTION_STATEMENT) !== normalized(step.body)) mismatch(step.name);
  return true;
}

export async function preflightStep6Migrations(connection, files, applied) {
  const [[{ db, logBin, trustCreators, metadataExists }]] = await connection.query(
    "SELECT DATABASE() db, @@log_bin logBin, @@log_bin_trust_function_creators trustCreators, (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations') metadataExists");
  const [rows] = await connection.query('SHOW GRANTS');
  const grants = rows.map(row => String(Object.values(row)[0])).map(line => line.match(/^GRANT (.+) ON (.+) TO /)).filter(Boolean);
  // Direct grants cover the current deployment account. Role-only grants fail closed:
  // never guess effective role privileges or change server settings during preflight.
  const has = (privilege, table) => grants.some(([, list, scope]) => {
    const scopes = ['*.*', `${identifier(db)}.*`, `${identifier(db)}.${identifier(table)}`];
    return scopes.includes(scope) && (list === 'ALL PRIVILEGES' || list.split(', ').includes(privilege));
  });
  const superPrivilege = grants.some(([, list, scope]) => scope === '*.*' && (list === 'ALL PRIVILEGES' || list.split(', ').includes('SUPER')));
  if (files.some(({ file }) => !applied.has(file.replace(/\.sql$/, '')))) {
    for (const privilege of ['INSERT', ...(!Number(metadataExists) ? ['CREATE'] : [])]) {
      if (!has(privilege, 'schema_migrations')) throw new MigrationGuardError('MIGRATION_PRIVILEGE_REQUIRED', `${privilege} on schema_migrations; no DDL executed`);
    }
  }
  const plans = new Map();
  for (const { file, sql } of files) {
    const steps = step6MigrationPlan(file, sql);
    if (!steps) continue;
    plans.set(file, steps);
    const recorded = applied.has(file.replace(/\.sql$/, ''));
    for (const step of steps) {
      const exists = await inspect(connection, step);
      if (recorded && !exists) mismatch(`${file}: recorded but ${step.name} missing`);
      if (exists) continue;
      const privileges = step.kind === 'trigger' ? ['TRIGGER'] : ['ALTER', 'CREATE', 'INSERT', ...(step.kind === 'index' ? ['INDEX'] : [])];
      for (const privilege of privileges) if (!has(privilege, step.table)) {
        throw new MigrationGuardError('MIGRATION_PRIVILEGE_REQUIRED', `${privilege} on ${step.table}; no DDL executed`);
      }
      if (step.kind === 'trigger' && Number(logBin) && !Number(trustCreators) && !superPrivilege) {
        throw new MigrationGuardError('MIGRATION_TRIGGER_PRIVILEGE_REQUIRED', 'binary logging requires additional trigger-creation authority; no DDL executed');
      }
    }
  }
  return plans;
}

export async function applyStep6Migration(connection, steps) {
  for (const step of steps) {
    if (await inspect(connection, step)) continue;
    await connection.query(step.sql);
    if (!await inspect(connection, step)) mismatch(`${step.name}: creation not visible`);
  }
}
