import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');

test('Actions R2 missing body exits before JSON parsing', () => {
  const start = source.indexOf('async function responseFromActionsObject');
  const block = source.slice(start, source.indexOf('async function loadActionsEnvelope'));
  assert.equal(block.indexOf('if (!object?.body) return null;') < block.indexOf('await object.json()'), true);
});
