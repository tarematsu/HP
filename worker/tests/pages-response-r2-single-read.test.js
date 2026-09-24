import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');

test('materialized R2 serving retains one-object lookup policy', () => {
  assert.match(source, /if \(modelKey === TRACK_HISTORY_MODEL_KEY\)/);
  assert.match(source, /return loadWorkerR2Response\(r2, modelKey, now, maximumAgeMs\)/);
  assert.match(source, /return loadActionsEnvelope\(r2, modelKey, now, maximumAgeMs\)/);
  assert.match(source, /every serving lookup performs at most one R2 get/);
});
