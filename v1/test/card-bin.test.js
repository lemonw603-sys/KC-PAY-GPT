import test from 'node:test';
import assert from 'node:assert/strict';
import { cardBin, binMatchesSegment } from '../src/domain/card-bin.js';

test('a BIN is the first eight digits, whatever spacing the source used', () => {
  assert.equal(cardBin('5139899654629839'), '51398996');
  assert.equal(cardBin('5139 8996 5462 9839'), '51398996');
  assert.equal(cardBin('5321-1304-1111-2222'), '53211304');
});

test('anything that is not a usable PAN yields null rather than a wrong BIN', () => {
  for (const value of [null, undefined, '', '1234567', 'abcdefgh', '  ']) {
    assert.equal(cardBin(value), null, String(value));
  }
});

test('a BIN matches both the 6- and 8-digit segments the platform lists', () => {
  assert.equal(binMatchesSegment('51398996', '513989'), true, 'the segment that declined four times');
  assert.equal(binMatchesSegment('53211304', '53211304'), true, 'the segment that paid');
  assert.equal(binMatchesSegment('51398996', '53211304'), false);
  assert.equal(binMatchesSegment('51398996', '512998'), false);
});

test('a segment longer than the stored BIN never counts as a match', () => {
  assert.equal(binMatchesSegment('513989', '51398996'), false);
  assert.equal(binMatchesSegment(null, '513989'), false);
  assert.equal(binMatchesSegment('51398996', ''), false);
});
