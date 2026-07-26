import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('Worker maintenance gates and rebuild Queue wrappers remain deleted', () => {
  for (const path of [
    '../src/minute-rebuild-batched-entry.js',
    '../src/minute-rebuild-maintenance-entry.js',
    '../src/minute-maintenance-optimized-entry.js',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  }
  const runtime = JSON.parse(source('../wrangler.runtime.jsonc'));
  assert.equal(runtime.triggers, undefined);
  assert.equal(runtime.queues.consumers.some(
    ({ queue }) => queue === 'stationhead-minute-rebuild',
  ), false);
  assert.equal(runtime.queues.producers.some(
    ({ binding }) => binding === 'MINUTE_DERIVE_QUEUE',
  ), false);
});

test('lower-level rebuild primitives remain available only to bounded Actions code', () => {
  const rebuild = source('../src/minute-rebuild-entry.js');
  const selector = source('../scripts/select-worker-deploys.mjs');
  const actions = source('../scripts/minute-facts-actions-window.mjs');

  assert.match(rebuild, /processMinuteRebuildStage/);
  assert.match(selector, /worker\/src\/minute-rebuild-entry\.js/);
  assert.match(actions, /cutoff_ms|complete/);
});

test('enrichment production wrapper logs fixed fields instead of spreading the complete result', () => {
  const enrichment = source('../src/minute-enrichment-optimized-entry.js');
  assert.match(enrichment, /function logMinuteEnrichmentResult/);
  assert.match(enrichment, /const RETRY_30_SECONDS = Object\.freeze/);
  assert.doesNotMatch(enrichment, /minute_enrichment_completed', \.\.\.result/);
});
