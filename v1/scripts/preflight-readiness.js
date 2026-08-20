import { isEnvTrue, loadRuntimeDatabaseConfig } from '../src/config.js';
import { createDatabasePool } from '../src/db/pool.js';
import { runReadinessAudit } from '../src/diagnostics/readiness-audit.js';

if ([
  'PROVIDER_WRITES_ENABLED',
  'PROVIDER_CARD_WRITES_ENABLED',
  'PROVIDER_RECHARGE_WRITES_ENABLED'
].some((key) => isEnvTrue(process.env[key]))) {
  throw new Error('Readiness audit refuses to run while any Provider write switch is enabled');
}

const pool = createDatabasePool(loadRuntimeDatabaseConfig());
try {
  const report = await runReadinessAudit(pool);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
} finally {
  await pool.end();
}
