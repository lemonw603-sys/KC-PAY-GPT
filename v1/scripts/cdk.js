import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { loadRuntimeDatabaseConfig } from '../src/config.js';
import { createDatabaseConnectionOptions } from '../src/db/pool.js';
import {
  CdkBatchError,
  generateCdks,
  normalizeBatchNo,
  normalizeImportedCdks,
  storeCdkBatch,
  validateBatchCount
} from '../src/services/cdk-service.js';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index];
    if (!name.startsWith('--') || index + 1 >= rest.length) {
      throw new CdkBatchError(`invalid argument: ${name}`, 'INVALID_ARGUMENT');
    }
    const key = name.slice(2);
    if (options[key] != null) {
      throw new CdkBatchError(`duplicate option: --${key}`, 'INVALID_ARGUMENT');
    }
    options[key] = rest[index + 1];
    index += 1;
  }
  return { command, options };
}

function requireOption(options, key) {
  const value = String(options[key] || '').trim();
  if (!value) throw new CdkBatchError(`--${key} is required`, 'MISSING_OPTION');
  return value;
}

async function writeNewPrivateFile(filePath, codes) {
  const absolutePath = path.resolve(filePath);
  await fs.writeFile(absolutePath, `${codes.join('\n')}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  });
  return absolutePath;
}

async function readImportFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) throw new CdkBatchError('--input must reference a regular file', 'INVALID_INPUT');
  if (stat.size > MAX_IMPORT_BYTES) {
    throw new CdkBatchError(`input file exceeds ${MAX_IMPORT_BYTES} bytes`, 'INPUT_TOO_LARGE');
  }
  return { absolutePath, text: await fs.readFile(absolutePath, 'utf8') };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (!['generate', 'import'].includes(command)) {
    throw new CdkBatchError('command must be generate or import', 'INVALID_COMMAND');
  }
  const allowedOptions = command === 'generate'
    ? new Set(['count', 'batch', 'output'])
    : new Set(['input', 'batch']);
  for (const key of Object.keys(options)) {
    if (!allowedOptions.has(key)) {
      throw new CdkBatchError(`unsupported option for ${command}: --${key}`, 'INVALID_ARGUMENT');
    }
  }
  let database;
  try {
    database = loadRuntimeDatabaseConfig();
  } catch {
    throw new CdkBatchError('database configuration is invalid', 'INVALID_DATABASE_CONFIG');
  }
  const batchNo = normalizeBatchNo(options.batch);
  let codes;
  let outputPath = null;
  let inputSummary = null;

  if (command === 'generate') {
    codes = generateCdks(validateBatchCount(requireOption(options, 'count')));
    outputPath = await writeNewPrivateFile(requireOption(options, 'output'), codes);
  } else if (command === 'import') {
    const input = await readImportFile(requireOption(options, 'input'));
    inputSummary = normalizeImportedCdks(input.text);
    codes = inputSummary.codes;
  }

  const pool = mysql.createPool(createDatabaseConnectionOptions(database, {
    connectionLimit: 2,
    timezone: 'Z'
  }));
  try {
    const result = await storeCdkBatch(pool, codes, {
      batchNo,
      requireAllInserted: command === 'generate'
    });
    const summary = {
      command,
      ...result,
      ...(inputSummary ? {
        inputCount: inputSummary.inputCount,
        duplicateInputCount: inputSummary.duplicateInputCount
      } : {}),
      ...(outputPath ? { output: outputPath } : {})
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    if (outputPath) {
      await fs.unlink(outputPath).catch(() => {});
    }
    throw error;
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  const code = error instanceof CdkBatchError ? error.code : 'CDK_COMMAND_FAILED';
  process.stderr.write(`${JSON.stringify({ error: code, message: error.message })}\n`);
  process.exitCode = 1;
}
