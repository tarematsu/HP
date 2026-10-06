import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../functions/api/dashboard.js', import.meta.url), 'utf8');
const dashboardDetails = readFileSync(new URL('../functions/api/dashboard-details.js', import.meta.url), 'utf8');
const dailySummaries = readFileSync(new URL('../functions/lib/dashboard-daily-summaries.js', import.meta.url), 'utf8');
const tracks = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const ranking = readFileSync(new URL('../functions/lib/track-ranking.js', import.meta.url), 'utf8');
const trackStage = readFileSync(new URL('../../worker/src/pages-track-history-stage.js', import.meta.url), 'utf8');
const splitCycle = readFileSync(new URL('../../worker/src/pages-track-history-split-cycle.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../../worker/src/runtime-orchestrator-entry.js', import.meta.url), 'utf8');
const responseFetch = readFileSync(new URL('../../worker/src/pages-response-fetch-entry.js', import.meta.url), 'utf8');
const runtime = JSON.parse(readFileSync(new URL('../../worker/wrangler.runtime.jsonc', import.meta.url), 'utf8'));
const workers = readFileSync(new URL('../../worker/scripts/cloudflare-workers.mjs', import.meta.url), 'utf8');

test('dashboard read model embeds chart details and completed daily summaries for read-only serving', () => {
  assert.match(dashboard, /loadDashboardDailySummaries/);
  assert.match(dashboard, /augmentDashboardChartData/);
  assert.match(dashboard, /daily_summaries/);
  assert.match(dashboardDetails, /loadDashboardDailySummaries/);
  assert.match(dashboardDetails, /daily_summaries/);
  assert.match(dailySummaries, /FROM sh_daily_summary/);
  assert.doesNotMatch(dashboardDetails, /FROM sh_daily_summary/);
});

test('like ranking is read only through the worker R2 materialized service', () => {
  assert.match(tracks, /PAGES_READ_MODEL_SERVICE/);
  assert.match(tracks, /url\.searchParams\.set\('key', TRACK_HISTORY_MODEL_KEY\)/);
  assert.match(tracks, /url\.searchParams\.set\('api', '1'\)/);
  assert.doesNotMatch(tracks, /MINUTE_DB|TRACK_RANKING_SQL|TRACK_RANKING_SUMMARY_SQL|sh_track_ranking_current|FROM sh_tracks|\.prepare\(/);
  assert.match(ranking, /FROM sh_track_ranking_current/);
  assert.doesNotMatch(ranking, /FROM sh_track_counter_current/);
});

test('track-history builders persist only R2 day models while D1 keeps compact control state', () => {
  assert.match(trackStage, /loadTrackRanking/);
  assert.match(trackStage, /materializeTrackHistoryRangeThroughR2/);
  assert.match(trackStage, /loadTrackHistoryDayIndex/);
  assert.doesNotMatch(trackStage, /sh_pages_track_history_read_model/);
  assert.match(splitCycle, /advanceTrackHistoryR2Publication/);
  assert.match(splitCycle, /advancePublicationInline/);
  assert.doesNotMatch(splitCycle, /advanceTrackHistoryPublication|promoteMaterializedD1ResponseToR2|sh_pages_response_manifest/);
  assert.doesNotMatch(splitCycle, /PAGES_READ_MODEL_QUEUE|enqueueTrackHistoryPublication/);
  assert.match(entry, /pages-response-fetch-entry\.js/);
  assert.match(entry, /runPagesResponseFetch/);
  assert.doesNotMatch(entry, /pages-read-model-entry|runPagesReadModelCron|scheduled\s*:/);
  assert.match(responseFetch, /loadMaterializedResponse/);
  assert.match(responseFetch, /pages-response-store\.js/);
  assert.doesNotMatch(responseFetch, /loadMaterializedR2Response|PAGES_RESPONSE_KV/);
  assert.doesNotMatch(responseFetch, /pages-read-model-dispatch|track-history-publication|PAGES_READ_MODEL_QUEUE/);
  assert.equal(runtime.triggers, undefined);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
});

test('only the five split production Workers remain active', () => {
  const activeBlock = workers.slice(workers.indexOf('ACTIVE_WORKER_NAMES'), workers.indexOf('RETIRED_WORKER_NAMES'));
  assert.equal((activeBlock.match(/'sh-/g) || []).length, 5);
  assert.match(activeBlock, /'sh-sakurazaka46jp'/);
  assert.match(activeBlock, /'sh-nogizaka46smej'/);
  assert.match(activeBlock, /'sh-buddies-recovery'/);
  assert.match(activeBlock, /'sh-buddies-collector'/);
  assert.match(activeBlock, /'sh-runtime-orchestrator'/);
});
