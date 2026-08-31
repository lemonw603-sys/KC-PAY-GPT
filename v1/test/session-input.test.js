import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSessionInput } from '../public/assets/session-input.js';

test('parses a complete Session object and removes only trailing copied text', () => {
  const parsed = parseSessionInput('  {"user":{"name":"a } b"},"token":"x\\\"{y"}  copied by helper  ');
  assert.deepEqual(parsed.value, { user: { name: 'a } b' }, token: 'x"{y' });
  assert.equal(parsed.hadTrailingText, true);
  assert.equal(parsed.canonical, '{"user":{"name":"a } b"},"token":"x\\\"{y"}');
});

test('accepts JSON fenced clipboard content and strips the closing fence', () => {
  const parsed = parseSessionInput('```json\n{"accessToken":"fixture"}\n```\nextra');
  assert.deepEqual(parsed.value, { accessToken: 'fixture' });
  assert.equal(parsed.hadTrailingText, true);
});

test('fails closed on leading labels, arrays, incomplete JSON, and non-JSON fences', () => {
  for (const value of [
    'Session: {"accessToken":"fixture"}',
    '[{"accessToken":"fixture"}]',
    '{"accessToken":"fixture"',
    '```text\n{"accessToken":"fixture"}\n```'
  ]) {
    assert.throws(() => parseSessionInput(value), (error) => error.code === 'invalid_session_json');
  }
});
