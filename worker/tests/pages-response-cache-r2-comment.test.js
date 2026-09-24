import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');

test('R2 serving documents strict 10 ms HTTP path', () => {
  assert.match(source, /strict 10 ms HTTP path/);
  assert.match(source, /at most one R2 get/);
});
