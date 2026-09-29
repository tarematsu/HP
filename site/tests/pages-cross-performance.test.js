import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const sakurazakaStatus = readFileSync(new URL('../public/sakurazaka46jp/live.js', import.meta.url), 'utf8');
const historySummary = readFileSync(new URL('../functions/lib/history-summary.js', import.meta.url), 'utf8');

test('ranking session cache survives ordinary page startup', () => {
  assert.doesNotMatch(history, /sessionStorage\.removeItem\([^)]*ranking/);
  assert.match(history, /sessionStorage\.getItem/);
});

test('current playback does not run a second metadata-repair observer or request', () => {
  assert.doesNotMatch(metrics, /history-global-fixes|repairPlaybackMetadata|ranking_only=1&ranking_limit=500/);
  assert.equal((metrics.match(/new MutationObserver/g) || []).length, 1);
  assert.match(metrics, /attributeFilter: \['src'\]/);
});

test('Sakurazaka realtime polling pauses while the page is hidden', () => {
  assert.match(sakurazakaStatus, /if \(document\.hidden\) return/);
  assert.match(sakurazakaStatus, /visibilitychange/);
  assert.match(sakurazakaStatus, /clearTimeout\(refreshTimer\)/);
  assert.match(sakurazakaStatus, /if \(!document\.hidden\) refreshTimer = setTimeout\(refresh, delay\)/);
});

test('history summary reads never persist repairs during a Pages request', () => {
  assert.doesNotMatch(historySummary, /persistCompletedBoundaryRepairs/);
  assert.doesNotMatch(historySummary, /summary_boundary_repair_persist_failed/);
  assert.doesNotMatch(historySummary, /UPDATE\s+\$\{table\}/);
  assert.doesNotMatch(historySummary, /\.run\(\)/);
});
