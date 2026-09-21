// Only for the disposable, network-disabled container created by pojia-ops restore-test.
// Never connects to DATABASE_URL; SQL travels over docker exec, secrets stay in memory.
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { decryptSecret } from '../src/security/secret-box.js';

const DATABASE = 'pojia_restore_test';
const TRIGGER = 'operator_alert_incident_version_before_update';
const DEFINER = 'pojia_migrator@172.17.0.1';
const BODY = "SET NEW.incident_version = OLD.incident_version + IF(OLD.status <> 'OPEN' AND NEW.status = 'OPEN', 1, 0)";
const KEY_NAMES = ['SESSION_ENCRYPTION_KEY_BASE64', 'CDK_RECOVERY_KEY_BASE64'];
function fail(code) { throw new Error(code); }
const normalize = value => String(value).replace(/[`\s;]/g, '').toUpperCase();

export function parseRestoreKeys(source) {
  const keys = {};
  for (const line of String(source).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*?)\s*$/);
    if (!match || !KEY_NAMES.includes(match[1])) continue;
    if (keys[match[1]]) fail('RESTORE_DUPLICATE_KEY');
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) fail('RESTORE_INVALID_KEY');
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== value) fail('RESTORE_INVALID_KEY');
    keys[match[1]] = decoded;
  }
  for (const name of KEY_NAMES) if (!keys[name]) fail(`RESTORE_MISSING_${name}`);
  return keys;
}

export function validateRestoreContainer(container, info) {
  if (!/^pojia-restore-test-[0-9]+$/.test(container)
    || info.Name !== '/' + container || !info.State?.Running
    || info.HostConfig?.NetworkMode !== 'none'
    || Object.keys(info.HostConfig?.PortBindings || {}).length
    || info.Config?.Labels?.['com.pojia.restore-test'] !== 'true') fail('RESTORE_CONTAINER_NOT_ISOLATED');
}

export function validateRestoreTrigger(rows, has057) {
  if (!has057) {
    if (rows.length) fail('RESTORE_UNEXPECTED_TRIGGER');
    return false;
  }
  const row = rows[0];
  if (rows.length !== 1 || row.name !== TRIGGER || row.table !== 'operator_alerts'
    || row.timing !== 'BEFORE' || row.event !== 'UPDATE' || row.orientation !== 'ROW'
    || normalize(row.body) !== normalize(BODY)) fail('RESTORE_TRIGGER_MISMATCH');
  if (row.definer !== DEFINER) fail('RESTORE_UNEXPECTED_DEFINER');
  return true;
}

async function run(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
    child.on('error', () => reject(new Error('RESTORE_DOCKER_UNAVAILABLE')));
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.on('close', code => {
      if (code !== 0) reject(new Error(`RESTORE_SQL_FAILED_${err.match(/ERROR (\d+)/)?.[1] || 'COMMAND'}`));
      else resolve(out.trim());
    });
  });
}

export async function verifyRestoredBackup({ container, keysFile, prepareDefiner = false }) {
  // Validate the exact target before any SQL, including read-only SQL.
  if (!/^pojia-restore-test-[0-9]+$/.test(container || '')) fail('RESTORE_CONTAINER_NOT_ISOLATED');
  const info = JSON.parse(await run(['inspect', container]))[0];
  validateRestoreContainer(container, info);
  const keyStat = await stat(keysFile);
  // Deployed runtime.env may be root:pojia 0640 so the application can read it.
  // Permit group-read, never group-write/execute or any other-user access.
  if (!keyStat.isFile() || (keyStat.mode & 0o027)
    || ![0, process.getuid?.()].includes(keyStat.uid)) fail('RESTORE_KEYS_FILE_PERMISSIONS');
  const keys = parseRestoreKeys(await readFile(keysFile, 'utf8'));
  const query = text => run(['exec', '-i', container, 'mysql', '-uroot', '--batch', '--raw', '--skip-column-names', DATABASE], text);
  const rows = async text => { const out = await query(text); return out ? out.split('\n').map(JSON.parse) : []; };
  const scalar = async text => Number(await query(text));
  const has057 = (await scalar("SELECT COUNT(*) FROM schema_migrations WHERE version='057_alert_incident_version'")) === 1;
  const has058 = (await scalar("SELECT COUNT(*) FROM schema_migrations WHERE version='058_app_settings_report_capacity'")) === 1;
  if (has058 && (await query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${DATABASE}' AND TABLE_NAME='app_settings' AND COLUMN_NAME='setting_value'`)) !== 'mediumtext') fail('RESTORE_REPORT_CAPACITY_MISMATCH');
  const triggers = await rows(`SELECT JSON_OBJECT('name',TRIGGER_NAME,'table',EVENT_OBJECT_TABLE,'timing',ACTION_TIMING,
    'event',EVENT_MANIPULATION,'orientation',ACTION_ORIENTATION,'body',ACTION_STATEMENT,'definer',DEFINER)
    FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${DATABASE}'`);
  const hasTrigger = validateRestoreTrigger(triggers, has057);
  const incidentColumns = await scalar(`SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA='${DATABASE}' AND TABLE_NAME IN ('operator_alerts','alert_notifications') AND COLUMN_NAME='incident_version'`);
  if (incidentColumns !== (has057 ? 2 : 0)) fail('RESTORE_PARTIAL_057');
  // No other stored executable objects are part of the current application contract.
  if (await scalar(`SELECT (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${DATABASE}')
    +(SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA='${DATABASE}')
    +(SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA='${DATABASE}')`)) fail('RESTORE_UNEXPECTED_STORED_OBJECT');
  let definerPrepared = false;
  if (hasTrigger) {
    const exists = await scalar("SELECT COUNT(*) FROM mysql.user WHERE User='pojia_migrator' AND Host='172.17.0.1'");
    if (!exists && !prepareDefiner) fail('RESTORE_DEFINER_MISSING');
    if (!exists) {
      // Locked account cannot log in. No global grants or other application tables.
      await query(`CREATE USER 'pojia_migrator'@'172.17.0.1' ACCOUNT LOCK;
        GRANT SELECT, UPDATE, TRIGGER ON ${DATABASE}.operator_alerts TO 'pojia_migrator'@'172.17.0.1';`);
      definerPrepared = true;
    }
  }
  // A read must actually join the restored business tables, not only count schema objects.
  const business = await rows(`SELECT JSON_OBJECT('orders',COUNT(o.id),'linkedCdks',COUNT(c.id))
    FROM orders o LEFT JOIN cdks c ON c.id=o.cdk_id`);
  if (business[0].orders !== business[0].linkedCdks) fail('RESTORE_ORDER_CDK_LINK_BROKEN');
  const samples = { sessions: 0, cdkBatches: 0 };
  const sessions = await rows(`SELECT JSON_OBJECT('cipher',HEX(session_ciphertext)) FROM orders
    WHERE session_ciphertext IS NOT NULL AND OCTET_LENGTH(session_ciphertext)>0 ORDER BY created_at DESC,id DESC LIMIT 3`);
  const batches = await rows(`SELECT JSON_OBJECT('cipher',HEX(codes_ciphertext),'count',requested_count)
    FROM cdk_batches WHERE codes_ciphertext IS NOT NULL ORDER BY created_at DESC,batch_no DESC LIMIT 3`);
  try {
    for (const row of sessions) {
      const session = JSON.parse(decryptSecret(Buffer.from(row.cipher, 'hex'), keys.SESSION_ENCRYPTION_KEY_BASE64));
      if (!session || typeof session !== 'object' || Array.isArray(session)) fail('RESTORE_SESSION_SHAPE');
      samples.sessions++;
    }
    for (const row of batches) {
      const codes = JSON.parse(decryptSecret(Buffer.from(row.cipher, 'hex'), keys.CDK_RECOVERY_KEY_BASE64));
      if (!Array.isArray(codes) || codes.length !== Number(row.count) || codes.some(code => typeof code !== 'string')) fail('RESTORE_CDK_SHAPE');
      samples.cdkBatches++;
    }
  } catch { fail('RESTORE_DECRYPTION_OR_SHAPE_FAILED'); }
  // No samples is not proof that the supplied key matches the backup.
  if (!samples.sessions || !samples.cdkBatches) fail('RESTORE_DECRYPTION_SAMPLE_MISSING');
  const summaries = await rows("SELECT JSON_OBJECT('value',setting_value) FROM app_settings WHERE setting_key='daily_reconciliation_last_report'");
  let dailySummary = 'NOT_PRESENT';
  if (summaries.length) {
    try {
      const saved = JSON.parse(summaries[0].value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(saved.date) || typeof saved.generatedAt !== 'string'
        || !Array.isArray(saved.discrepancyFingerprints) || !Array.isArray(saved.persistentFingerprints)
        || ![...saved.discrepancyFingerprints,...saved.persistentFingerprints].every(x => typeof x === 'string')) throw Error('shape');
      dailySummary = 'OK';
    } catch { fail('RESTORE_DAILY_SUMMARY_INVALID'); }
  }
  let incidentVersion = null;
  if (hasTrigger) {
    const id = randomUUID();
    // Insert a synthetic row, never alter a restored real alert. Single connection;
    // rollback removes the probe even if a later command fails and the client exits.
    const result = await query(`START TRANSACTION;
      INSERT INTO operator_alerts(id,alert_type,dedupe_key,severity,title,message,status)
      VALUES('${id}','RESTORE_TEST','restore-test:${id}','warning','restore test','synthetic','OPEN');
      UPDATE operator_alerts SET status='RESOLVED' WHERE id='${id}';
      UPDATE operator_alerts SET status='OPEN' WHERE id='${id}';
      SELECT incident_version FROM operator_alerts WHERE id='${id}';
      ROLLBACK;`);
    incidentVersion = Number(result);
    if (incidentVersion !== 2) fail('RESTORE_TRIGGER_PROBE_FAILED');
    if (await scalar(`SELECT COUNT(*) FROM operator_alerts WHERE id='${id}'`)) fail('RESTORE_PROBE_NOT_ROLLED_BACK');
  }
  return { businessRead: 'OK', decryptedSamples: samples, dailySummary,
    alertTrigger: hasTrigger ? 'OK' : 'NOT_APPLICABLE_PRE057', incidentVersion, definerPrepared,
    scope: 'isolated representative checks; not production or offsite recovery acceptance' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [container, keysFile, mode] = process.argv.slice(2);
  try {
    if (!container || !keysFile || (mode && mode !== '--prepare-definer') || process.argv.length > 5) fail('RESTORE_ARGUMENTS');
    console.log('restore_functional=' + JSON.stringify(await verifyRestoredBackup({ container, keysFile, prepareDefiner: mode === '--prepare-definer' })));
  } catch (error) {
    // Never print errors carrying SQL output, ciphertext, key material or plaintext.
    console.error('error=' + (/^RESTORE_[A-Z0-9_]+$/.test(error.message) ? error.message : 'RESTORE_VERIFICATION_FAILED'));
    process.exitCode = 1;
  }
}
