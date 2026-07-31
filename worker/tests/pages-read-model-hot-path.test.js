import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

const runnerSource = readFileSync(
  new URL('../scripts/run-pages-read-model-actions.mjs', import.meta.url),
  'utf8',
);
const d1AdapterSource = readFileSync(
  new URL('../scripts/remote-d1-adapter.mjs', import.meta.url),
  'utf8',
);
const responseSource = readFileSync(
  new URL('../src/pages-response-fetch-entry.js', import.meta.url),
  'utf8',
);
const runtimeSource = readFileSync(
  new URL('../src/runtime-orchestrator-entry.js', import.meta.url),
  'utf8',
);
const runtimeConfig = JSON.parse(readFileSync(
  new URL('../wrangler.runtime.jsonc', import.meta.url),
  'utf8',
));

const REQUEST = new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');

test('runtime exposes only the R2 serving hot path for completed history', async () => {
  const calls = [];
  const response = await runPagesResponseFetch(REQUEST, {}, {
    loadResponse: async () => { calls.push('kv'); return Response.json({ source: 'kv' }); },
    loadR2Response: async () => { calls.push('r2'); return Response.json({ source: 'r2' }); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { source: 'r2' });
  assert.deepEqual(calls, ['r2']);
  assert.match(runtimeSource, /pages-response-fetch-entry\.js/);
  assert.doesNotMatch(runtimeSource, /pages-read-model-entry|pages-read-model-dispatch|pages-six-hour-read-model/);
});

test('missing materialized response returns a closed 404 without generating data', async () => {
  const response = await runPagesResponseFetch(REQUEST, {}, {
    loadResponse: async () => null,
    loadR2Response: async () => null,
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('serving module stays independent from render and publication graphs', () => {
  assert.match(responseSource, /loadMaterializedResponse/);
  assert.match(responseSource, /loadMaterializedR2Response/);
  assert.match(responseSource, /loadEdgeCachedResponse/);
  assert.doesNotMatch(responseSource, /dashboard\.js|history\.js|host-history\.js/);
  assert.doesNotMatch(responseSource, /PAGES_READ_MODEL_QUEUE|track-history-publication|runSplitTrackHistoryCycleStep/);
});

test('Actions runner owns summary rendering, tier selection, D1 reads, and R2 publication', () => {
  assert.match(runnerSource, /MATERIALIZED_API_VARIANTS/);
  assert.match(runnerSource, /responseHandler/);
  assert.match(runnerSource, /dueVariantKeys/);
  assert.match(runnerSource, /createWranglerRemoteD1/);
  assert.match(runnerSource, /track-history-read-model-disabled/);
  assert.doesNotMatch(runnerSource, /runSplitTrackHistoryCycleStep|pages-track-history/);
  assert.match(d1AdapterSource, /'d1', 'execute', database/);
  assert.match(d1AdapterSource, /'--remote', '--yes', '--json'/);
  assert.match(runnerSource, /r2', 'object', 'put'/);
});

test('runtime configuration contains no Pages scheduler or read-model Queue', () => {
  assert.equal(runtimeConfig.triggers, undefined);
  assert.equal(runtimeConfig.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
  assert.equal(runtimeConfig.queues.producers.some(({ binding }) => binding.includes('READ_MODEL')), false);
});
