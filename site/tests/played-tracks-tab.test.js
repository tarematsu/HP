import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/played-tracks-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/played-tracks.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('played tracks tab is mounted immediately before likes', () => {
  assert.match(shell, /querySelector\('\[data-view="likes"\]'\)/);
  assert.match(shell, /button\.dataset\.view = 'played-tracks'/);
  assert.match(shell, /likes\.insertAdjacentElement\('beforebegin', button\)/);
  assert.match(shell, /id="playedTracksView"/);
});

test('played tracks uses the fixed September 22 experiment range', () => {
  assert.match(runtime, /const TARGET_DATE = '2026-09-22'/);
  assert.match(runtime, /\/api\/track-history\?from=\$\{TARGET_DATE\}&to=\$\{TARGET_DATE\}&limit=10000&ranking=0/);
  assert.match(runtime, /state\.total = state\.rows\.reduce\(\(sum, row\) => sum \+ row\.play_count, 0\)/);
  assert.match(runtime, /totalShare\.textContent = state\.total > 0 \? '100\.0%'/);
  assert.match(runtime, /row\.play_count \/ state\.total \* 100/);
});

test('played tracks runtime is lazy while its shell loads before dashboard tabs', () => {
  assert.match(metrics, /played-tracks-shell\.js/);
  assert.ok(metrics.indexOf('played-tracks-shell.js') < metrics.indexOf('dashboard-tabs.js'));
  assert.match(tabs, /'played-tracks'/);
  assert.match(tabs, /import\('\/played-tracks\.js\?v=20260923\.1'\)/);
});
