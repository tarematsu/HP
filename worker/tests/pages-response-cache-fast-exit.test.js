import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('fresh cache hit returns immediately before storage routing', () => {
  const hit = source.indexOf('if (edgeResponse) return edgeResponse;');
  const storage = source.indexOf('if (R2_ONLY_MODEL_KEYS.has(modelKey))');
  assert.equal(hit >= 0 && storage >= 0 && hit < storage, true);
});
