import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');

test('R2 policy does not probe retired response keys', () => {
  assert.doesNotMatch(source, /legacy/i);
  assert.match(source, /ACTIONS_RESPONSE_KEY_PREFIX = 'pages-response\/actions-v2\/'/);
});
