import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');

test('R2 serving routes directly by track-history key', () => {
  const start = source.indexOf('export async function loadMaterializedR2Response');
  const block = source.slice(start);
  assert.match(block, /if \(modelKey === TRACK_HISTORY_MODEL_KEY\)/);
  assert.doesNotMatch(block, /for \(|while \(/);
});
