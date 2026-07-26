import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../worker/scripts/run-pages-read-model-actions.mjs', import.meta.url), 'utf8');
const deployedEntry = readFileSync(new URL('../worker/src/runtime-orchestrator-deployed-entry.js', import.meta.url), 'utf8');
const runtimeEntry = readFileSync(new URL('../worker/src/runtime-orchestrator-entry.js', import.meta.url), 'utf8');
const responseFetch = readFileSync(new URL('../worker/src/pages-response-fetch-entry.js', import.meta.url), 'utf8');
const r2Store = readFileSync(new URL('../worker/src/pages-response-r2.js', import.meta.url), 'utf8');
const runtime = JSON.parse(readFileSync(new URL('../worker/wrangler.runtime.jsonc', import.meta.url), 'utf8'));

test('pages read models rebuild frequently in one bounded Actions job', () => {
  assert.match(workflow, /cron: '4,19,34,49 \* \* \* \*'/);
  assert.match(workflow, /group: pages-read-model-rebuild/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /PAGES_RESPONSE_BUCKET/);
  assert.match(workflow, /run-pages-read-model-actions\.mjs/);
  assert.match(runner, /runSplitTrackHistoryCycleStep/);
  assert.match(runner, /while \(steps < maxSteps && Date\.now\(\) < deadlineMs\)/);
  assert.match(runner, /dueVariantKeys/);
  assert.match(runner, /history:daily/);
  assert.match(runner, /history:weekly/);
  assert.match(runner, /history:monthly/);
  assert.match(runner, /history:broadcasts/);
  assert.match(runner, /host-history:summary/);
  assert.match(runner, /r2', 'object', 'put'/);
  assert.match(runner, /d1', 'execute'.*--remote/s);
  assert.match(r2Store, /pages-response\/actions-v1/);
  assert.match(r2Store, /x-api-source', 'actions-r2'/);
});

test('runtime serves materialized responses through a serving-only module', () => {
  assert.equal(runtime.triggers, undefined);
  assert.equal(Object.hasOwn(runtime.vars, 'PAGES_TRACK_HISTORY_CYCLE_ENABLED'), false);
  assert.doesNotMatch(deployedEntry, /scheduled\s*:|runRuntimeOrchestratorScheduled/);
  assert.match(runtimeEntry, /pages-response-fetch-entry\.js/);
  assert.match(runtimeEntry, /runPagesResponseFetch/);
  assert.doesNotMatch(runtimeEntry, /pages-read-model-entry|runPagesReadModelCron|runCoreScheduled|pagesScheduledDue/);
  assert.match(responseFetch, /loadMaterializedR2Response/);
  assert.match(responseFetch, /loadMaterializedResponse/);
  assert.doesNotMatch(responseFetch, /pages-read-model-dispatch|track-history-publication|PAGES_READ_MODEL_QUEUE/);
});
