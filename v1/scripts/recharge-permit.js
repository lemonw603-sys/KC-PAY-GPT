import mysql from 'mysql2/promise';
import { loadRuntimeDatabaseConfig } from '../src/config.js';
import { createDatabaseConnectionOptions } from '../src/db/pool.js';
import {
  RechargePermitError,
  armRechargePermit,
  getRechargePermitStatus,
  revokeRechargePermit
} from '../src/services/recharge-permit-service.js';

function parseArguments(argv) {
  const [command, publicNo, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || value == null) throw new Error('invalid arguments');
    options[key.slice(2)] = value;
  }
  return { command, publicNo, options };
}

async function main() {
  const { command, publicNo, options } = parseArguments(process.argv.slice(2));
  if (!['arm', 'revoke', 'status'].includes(command) || !publicNo) {
    throw new RechargePermitError('usage: recharge-permit <arm|revoke|status> <public-no> [--ttl-minutes 10]', 'INVALID_ARGUMENT');
  }
  const database = loadRuntimeDatabaseConfig();
  const pool = mysql.createPool(createDatabaseConnectionOptions(database, { connectionLimit: 2, timezone: 'Z' }));
  try {
    const input = { publicNo };
    const result = command === 'arm'
      ? await armRechargePermit(pool, { ...input, ttlMinutes: options['ttl-minutes'] || 10 })
      : command === 'revoke'
        ? await revokeRechargePermit(pool, input)
        : await getRechargePermitStatus(pool, input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.code || 'RECHARGE_PERMIT_FAILED', message: error.message })}\n`);
  process.exitCode = 1;
}
