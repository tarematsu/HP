import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const currentRuntime = browserSource('stationhead-channel.js');
const history = browserSource('history/history-lite.js');
const officialLive = readFileSync(new URL('../public/official-account-live.js', import.meta.url), 'utf8');
const historyApi = readFileSync(new URL('../functions/api/history.js', import.meta.url), 'utf8');

test('ranking session cache survives ordinary page startup', () => {
  assert.doesNotMatch(history, /sessionStorage\.removeItem\([^)]*ranking/);
  assert.match(history, /storage\.getItem/);
});

test('current playback does not run metadata-repair or image MutationObservers', () => {
  const playbackSources = `${metrics}\n${currentRuntime}`;
  assert.doesNotMatch(playbackSources, /history-global-fixes|repairPlaybackMetadata|ranking_only=1&ranking_limit=500/);
  assert.doesNotMatch(playbackSources, /new MutationObserver|attributeFilter: \['src'\]/);
  assert.match(currentRuntime, /track\?\.thumbnail_url/);
});

test('official realtime polling pauses while the page is hidden', () => {
  assert.match(officialLive, /if \(document\.hidden\) return/);
  assert.match(officialLive, /visibilitychange/);
  assert.match(officialLive, /clearTimeout\(refreshTimer\)/);
  assert.match(officialLive, /if \(!document\.hidden\) refreshTimer = setTimeout\(refresh, delay\)/);
});

test('history summary requests reuse the shared materialized summary without repair writes', () => {
  assert.match(historyApi, /loadMaterializedSummary/);
  assert.doesNotMatch(historyApi, /persistCompletedBoundaryRepairs|summary_boundary_repair_persist_failed|UPDATE\s+|\.run\(\)/);
});
