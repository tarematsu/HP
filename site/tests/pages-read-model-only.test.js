import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../functions/api/dashboard.js', import.meta.url), 'utf8');
const dailySummaries = readFileSync(new URL('../functions/lib/dashboard-daily-summaries.js', import.meta.url), 'utf8');
const tracks = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const ranking = readFileSync(new URL('../functions/lib/track-ranking.js', import.meta.url), 'utf8');
const trackStage = readFileSync(new URL('../../worker/src/pages-track-history-stage.js', import.meta.url), 'utf8');
const splitCycle = readFileSync(new URL('../../worker/src/pages-track-history-split-cycle.js', import.meta.url), 'utf8');
const actions = readFileSync(new URL('../../worker/scripts/run-pages-read-model-actions.mjs', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../../worker/src/runtime-orchestrator-entry.js', import.meta.url), 'utf8');
const responseFetch = readFileSync(new URL('../../worker/src/pages-response-fetch-entry.js', import.meta.url), 'utf8');
const runtime = JSON.parse(readFileSync(new URL('../../worker/wrangler.runtime.jsonc', import.meta.url), 'utf8'));
const workers = readFileSync(new URL('../../worker/scripts/cloudflare-workers.mjs', import.meta.url), 'utf8');

// Pages remains read-only. Production Worker ownership is split across the
// Sakurazaka monitor, buddies recovery, buddies collector, and runtime orchestrator.
test('dashboard composes completed daily summaries through a focused loader', () => {
  assert.match(dashboard, /loadDashboardDailySummaries/);
  assert.match(dashboard, /daily_summaries/);
  assert.match(dailySummaries, /FROM sh_daily_summary/);
  assert.doesNotMatch(dashboard, /FROM sh_daily_summary/);
});

test('like ranking bypasses the playback-history read model', () => {
  assert.match(tracks, /ranking_only/);
  assert.match(tracks, /loadTrackRanking/);
  assert.match(tracks, /current_track_like_ranking/);
  assert.match(ranking, /FROM sh_track_ranking_current/);
  assert.doesNotMatch(ranking, /FROM sh_track_counter_current/);
});

test('track-history builders remain available only for explicit maintenance', () => {
  assert.match(trackStage, /loadTrackRanking/);
  assert.match(trackStage, /sh_pages_track_history_read_model/);
  assert.match(splitCycle, /advanceTrackHistoryPublication/);
  assert.match(splitCycle, /advanceTrackHistoryR2Publication/);
  assert.match(splitCycle, /advancePublicationInline/);
  assert.doesNotMatch(splitCycle, /PAGES_READ_MODEL_QUEUE|enqueueTrackHistoryPublication/);
  assert.doesNotMatch(actions, /runSplitTrackHistoryCycleStep|trackHistoryPublishedThisRun|dueKeys\.add\('track-history'\)/);
  assert.match(actions, /track-history-read-model-disabled/);
  assert.match(actions, /PAGES_READ_MODEL_DEADLINE_MS/);
  assert.match(actions, /pagesActionsR2ResponseKey/);
  assert.match(entry, /pages-response-fetch-entry\.js/);
  assert.match(entry, /runPagesResponseFetch/);
  assert.doesNotMatch(entry, /pages-read-model-entry|runPagesReadModelCron|scheduled\s*:/);
  assert.match(responseFetch, /loadMaterializedR2Response/);
  assert.match(responseFetch, /loadMaterializedResponse/);
  assert.doesNotMatch(responseFetch, /pages-read-model-dispatch|track-history-publication|PAGES_READ_MODEL_QUEUE/);
  assert.equal(runtime.triggers, undefined);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
});

test('only the four split production Workers remain active', () => {
  const activeBlock = workers.slice(workers.indexOf('ACTIVE_WORKER_NAMES'), workers.indexOf('RETIRED_WORKER_NAMES'));
  assert.equal((activeBlock.match(/'sh-/g) || []).length, 4);
  assert.match(activeBlock, /'sh-sakurazaka46jp'/);
  assert.match(activeBlock, /'sh-buddies-recovery'/);
  assert.match(activeBlock, /'sh-buddies-collector'/);
  assert.match(activeBlock, /'sh-runtime-orchestrator'/);
});
