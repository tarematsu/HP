import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('worker health responses stay compact', () => {
  const main = readFileSync(
    new URL('../worker/src/main.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(main, /JSON\.stringify\(normalizeHealthPayload\(payload\), null, 2\)/);
});
