import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageFixes = readFileSync(new URL('../public/history/history-page-fixes.js', import.meta.url), 'utf8');
const globalFixes = readFileSync(new URL('../public/history/history-global-fixes.js', import.meta.url), 'utf8');
const sakurazakaStatus = readFileSync(new URL('../public/sakurazaka46jp/live.js', import.meta.url), 'utf8');
const historySummary = readFileSync(new URL('../functions/lib/history-summary.js', import.meta.url), 'utf8');

test('ranking session cache survives ordinary page startup', () => {
  assert.doesNotMatch(pageFixes, /sessionStorage\.removeItem/);
  assert.doesNotMatch(pageFixes, /mode=ranking/);
});

test('playback metadata recovery does not observe the whole current view', () => {
  assert.doesNotMatch(globalFixes, /observe\(currentView/);
  assert.match(globalFixes, /observe\(nowPlayingLink/);
  assert.match(globalFixes, /observe\(queue/);
  assert.match(globalFixes, /\['trackTitle', 'trackArtist'\]/);
  assert.doesNotMatch(globalFixes, /trackTime/);
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
