import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const minutePipeline = readFileSync(
  new URL('../src/minute-pipeline-entry.js', import.meta.url),
  'utf8',
);
const runtimeConfig = readFileSync(
  new URL('../wrangler.runtime.jsonc', import.meta.url),
  'utf8',
);
const runtimeEntry = readFileSync(
  new URL('../src/runtime-orchestrator-entry.js', import.meta.url),
  'utf8',
);
const liveCompleteMessage = readFileSync(
  new URL('../src/minute-live-complete-message.js', import.meta.url),
  'utf8',
);
const liveCompleteEntry = readFileSync(
  new URL('../src/minute-live-complete-budget-entry.js', import.meta.url),
  'utf8',
);
const liveTriggerEntry = readFileSync(
  new URL('../src/minute-live-trigger-budget-entry.js', import.meta.url),
  'utf8',
);
const minuteEnrichment = readFileSync(
  new URL('../src/minute-enrichment-optimized-entry.js', import.meta.url),
  'utf8',
);
const pagesActions = readFileSync(
  new URL('../scripts/run-pages-read-model-actions.mjs', import.meta.url),
  'utf8',
);

test('live derive fallback keeps budget stages available and the full graph lazy', () => {
  for (const moduleName of [
    'minute-live-trigger-budget-entry.js',
    'minute-live-revision-budget-entry.js',
    'minute-live-write-budget-entry.js',
    'minute-live-complete-budget-entry.js',
  ]) {
    assert.match(minutePipeline, new RegExp(`from './${moduleName.replaceAll('.', '\\.')}'`));
    assert.doesNotMatch(minutePipeline, new RegExp(`import\\('./${moduleName.replaceAll('.', '\\.')}'\\)`));
  }

  assert.match(minutePipeline, /budgetedLiveCompleteBatch/);
  assert.match(minutePipeline, /import\('\.\/minute-derive-entry\.js'\)/);
  assert.match(minutePipeline, /import\('\.\/minute-rebuild-batched-entry\.js'\)/);
  assert.match(runtimeConfig, /"LIVE_REVISION_MATERIALIZATION_ENABLED"\s*:\s*false/);
});

test('core queue routes recurring live stages before loading the shared runtime graph', () => {
  for (const moduleName of [
    'minute-live-trigger-budget-entry.js',
    'minute-live-revision-budget-entry.js',
    'minute-live-write-budget-entry.js',
    'minute-live-complete-budget-entry.js',
  ]) {
    assert.match(runtimeEntry, new RegExp(`import\\('./${moduleName.replaceAll('.', '\\.')}'\\)`));
    assert.doesNotMatch(runtimeEntry, new RegExp(`from './${moduleName.replaceAll('.', '\\.')}'`));
  }
  assert.match(runtimeEntry, /from '\.\/minute-live-complete-message\.js'/);
  assert.match(liveCompleteEntry, /from '\.\/minute-live-complete-message\.js'/);
  assert.doesNotMatch(liveCompleteMessage, /COMPLETE_LIVE_MINUTE_FACT_JOB_SQL/);
  assert.match(runtimeEntry, /lightweightLiveBudgetKind/);
  assert.match(runtimeEntry, /if \(liveKind\) return runLightweightLiveQueue/);
});

test('live trigger uses the narrow lease boundary instead of loading derive and inbox graphs', () => {
  assert.match(liveTriggerEntry, /from '\.\/minute-live-trigger-lease\.js'/);
  assert.doesNotMatch(liveTriggerEntry, /from '\.\/minute-derive-queue\.js'/);
  assert.doesNotMatch(liveTriggerEntry, /from '\.\/minute-facts-inbox\.js'/);
});

test('runtime keeps queue and fetch graphs lazy without a scheduled graph', () => {
  for (const moduleName of [
    'minute-enrichment-optimized-entry.js',
    'pages-read-model-entry.js',
    'runtime-queue.js',
  ]) {
    assert.match(runtimeEntry, new RegExp(`import\\('./${moduleName.replaceAll('.', '\\.')}'\\)`));
    assert.doesNotMatch(runtimeEntry, new RegExp(`from './${moduleName.replaceAll('.', '\\.')}'`));
  }
  assert.doesNotMatch(runtimeEntry, /runtime-scheduled|runCoreScheduled|scheduled\s*:/);
  assert.doesNotMatch(runtimeEntry, /ingest-channel-optimized-entry/);
});

test('minute enrichment is queue-only and does not preload Pages generation', () => {
  assert.match(minuteEnrichment, /from '\.\/track-metadata-entry\.js'/);
  assert.match(minuteEnrichment, /queue: processMinuteEnrichmentBatch/);
  assert.doesNotMatch(minuteEnrichment, /pagesModulePromise|pages-read-model-entry|runPagesReadModelCron|scheduled\s*:/);
});

test('Pages recurring generation is loaded only by the bounded Actions runner', () => {
  assert.match(pagesActions, /runSplitTrackHistoryCycleStep/);
  assert.match(pagesActions, /MATERIALIZED_API_VARIANTS/);
  assert.match(pagesActions, /PAGES_READ_MODEL_DEADLINE_MS/);
  assert.match(pagesActions, /dueVariantKeys/);
  assert.equal(JSON.parse(runtimeConfig).triggers, undefined);
});

test('Cloudflare Pipelines analytics is absent from runtime module graphs', () => {
  assert.doesNotMatch(runtimeEntry, /runtime-pipeline-analytics\.js|RUNTIME_ANALYTICS_STREAM/);
});
