import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const currentRuntime = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const officialLive = readFileSync(new URL('../public/official-account-live.js', import.meta.url), 'utf8');
const historySummary = readFileSync(new URL('../functions/lib/history-summary.js', import.meta.url), 'utf8');

test('ranking session cache survives ordinary page startup', () => {
  assert.doesNotMatch(history, /sessionStorage\.removeItem\([^)]*ranking/);
  assert.match(history, /sessionStorage\.getItem/);
});

test('current playback does not run metadata-repair or image MutationObservers', () => {
  const playbackSources = `${metrics}\n${currentRuntime}`;
  assert.doesNotMatch(playbackSources, /history-global-fixes|repairPlaybackMetadata|ranking_only=1&ranking_limit=500/);
  assert.doesNotMatch(playbackSources, /new MutationObserver|attributeFilter: \['src'\]/);
  assert.match(currentRuntime, /addEventListener\('error', failed\)/);
});

test('official realtime polling pauses while the page is hidden', () => {
  assert.match(officialLive, /if \(document\.hidden\) return/);
  assert.match(officialLive, /visibilitychange/);
  assert.match(officialLive, /clearTimeout\(refreshTimer\)/);
  assert.match(officialLive, /if \(!document\.hidden\) refreshTimer = setTimeout\(refresh, delay\)/);
});

test('history summary reads never persist repairs during a Pages request', () => {
  assert.doesNotMatch(historySummary, /persistCompletedBoundaryRepairs/);
  assert.doesNotMatch(historySummary, /summary_boundary_repair_persist_failed/);
  assert.doesNotMatch(historySummary, /UPDATE\s+\$\{table\}/);
  assert.doesNotMatch(historySummary, /\.run\(\)/);
});
