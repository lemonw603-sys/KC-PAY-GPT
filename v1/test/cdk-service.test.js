import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateCdks,
  normalizeBatchNo,
  normalizeImportedCdks,
  validateBatchCount
} from '../src/services/cdk-service.js';

test('generates unique high-entropy-shaped CDKs without ambiguous characters', () => {
  const codes = generateCdks(250);
  assert.equal(new Set(codes).size, 250);
  for (const code of codes) {
    assert.match(code, /^PJ-[A-HJ-KM-NP-Z2-9]{20}$/);
    assert.doesNotMatch(code, /[01ILO]/);
  }
});

test('normalizes line imports and reports duplicates without changing case', () => {
  const result = normalizeImportedCdks('\uFEFFPJ-ABCDEFGH\r\nPJ-abcdefgh\nPJ-ABCDEFGH\n\n');
  assert.deepEqual(result, {
    codes: ['PJ-ABCDEFGH', 'PJ-abcdefgh'],
    inputCount: 3,
    duplicateInputCount: 1
  });
  assert.throws(() => normalizeImportedCdks('bad code'), (error) => error.code === 'INVALID_CDK');
});

test('validates count and creates traceable bounded batch identifiers', () => {
  assert.equal(validateBatchCount('100'), 100);
  assert.throws(() => validateBatchCount(0), (error) => error.code === 'INVALID_COUNT');
  assert.throws(() => validateBatchCount(10_001), (error) => error.code === 'INVALID_COUNT');
  assert.equal(normalizeBatchNo('batch_20260817'), 'batch_20260817');
  assert.equal(normalizeBatchNo(null, {
    now: () => new Date('2026-08-17T10:20:30.123Z'),
    randomSuffix: () => 'A1B2C3'
  }), 'B-20260817102030123-A1B2C3');
});
