import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

const responseSource = readFileSync(
  new URL('../src/pages-response-fetch-entry.js', import.meta.url),
  'utf8',
);
const refreshSource = readFileSync(
  new URL('../src/history-read-model-refresh.js', import.meta.url),
  'utf8',
);
const scheduledSource = readFileSync(
  new URL('../src/scheduled-collection-jobs-entry.js', import.meta.url),
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
const scheduledConfig = JSON.parse(readFileSync(
  new URL('../wrangler.scheduled-collection-jobs.jsonc', import.meta.url),
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
  assert.match(runtimeSource, /request\.url\.includes\(MINUTE_RUNTIME_STATE_PATH\)/);
  assert.doesNotMatch(
    runtimeSource,
    /export async function runCoreFetch\([^)]*\) \{\n  const url = new URL\(request\.url\);/,
  );
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
  assert.match(responseSource, /loadMaterializedR2Response/);
  assert.doesNotMatch(responseSource, /dashboard\.js|history\.js|host-history\.js/);
  assert.doesNotMatch(responseSource, /PAGES_READ_MODEL_QUEUE|track-history-publication|runSplitTrackHistoryCycleStep/);
});

test('scheduled collection Worker owns revision detection, rendering, and publication', () => {
  assert.match(refreshSource, /loadHistorySourceRevisions/);
  assert.match(refreshSource, /renderHistoryReadModel/);
  assert.match(refreshSource, /publishHistoryReadModel/);
  assert.match(refreshSource, /HISTORY_READ_MODEL_QUEUE/);
  assert.match(scheduledSource, /HISTORY_READ_MODEL_RECOVERY_CRON/);
  assert.match(scheduledSource, /refreshLeaderboard[\s\S]*enqueueHistory/);
  assert.equal(scheduledConfig.queues.consumers.some(({ queue }) => queue === 'pages-history-refresh'), true);
});

test('runtime configuration contains no Pages scheduler or read-model Queue', () => {
  assert.equal(runtimeConfig.triggers, undefined);
  assert.equal(runtimeConfig.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
  assert.equal(runtimeConfig.queues.producers.some(({ binding }) => binding.includes('READ_MODEL')), false);
});
