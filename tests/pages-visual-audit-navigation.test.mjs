import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { auditRoutes, kkboxAuditRoutes } from '../scripts/capture-pages-visual-audit.mjs';
import { NAVIGATION } from '../site/public/dashboard-navigation-config.js';

const source = readFileSync(new URL('../scripts/capture-pages-visual-audit.mjs', import.meta.url), 'utf8');
test('visual audit covers every registered route across all sources', () => {
  const routes = auditRoutes();
  assert.deepEqual(routes.map(({ mode }) => mode).sort(), NAVIGATION.flatMap(section => section.sources.flatMap(channel => channel.functions.map(item => item.mode))).sort());
  assert.equal(new Set(routes.map(({ mode }) => mode)).size, routes.length);
  assert.ok(routes.some(({ source, mode }) => source === 'hinata' && mode === 'hinata'));
  assert.ok(routes.some(({ source }) => source === 'kugou_music'));
});
test('visual audit uses current navigation and retains screenshots when a route fails', () => {
  assert.doesNotMatch(source, /#modeTabs/);
  assert.match(source, /#sectionTabs button/);
  assert.match(source, /response.status\(\) >= 400/);
  assert.match(source, /views.push\(\{ tab, viewport: viewport.name, screenshot, ok: false/);
});

test('visual audit waits for history data and fresh chart paint before recording a successful screenshot', () => {
  assert.match(source, /history:data-loaded/);
  assert.match(source, /history:period-chart-drawn/);
  assert.ok(source.includes('window.__pagesAuditHistory'));
  assert.match(source, /historyWaitTimedOut/);
  assert.match(source, /history summary returned no rows/);
});

test('visual audit waits for played-track metrics and rows before screenshot', () => {
  assert.match(source, /playedTracksMode/);
  assert.match(source, /playedTracksWaitTimedOut/);
  assert.match(source, /data-role="played-total"/);
  assert.match(source, /data-role="played-unique"/);
  assert.match(source, /data-role="played-tbody"/);
  assert.match(source, /played-tracks data was not rendered within 20 seconds/);
  assert.match(source, /played-tracks summary metrics remained placeholders/);
});

test('visual audit requires every listening-party subview to be visibly rendered', () => {
  assert.match(source, /listeningPartyMode/);
  assert.match(source, /if \(listeningPartyMode\) \{[\s\S]*?await revealPage\(page\);[\s\S]*?await settle\(page\);[\s\S]*?try \{/);
  assert.match(source, /#unofficialListeningTbody tr'[\s\S]*?timeout: 45_000/);
  assert.match(source, /official listening party chart was not painted/);
  assert.match(source, /official listening party table was not rendered/);
  assert.match(source, /first-week comparison panel is hidden/);
  assert.match(source, /first-week comparison chart was not painted/);
  assert.match(source, /unofficial listening party panel is hidden/);
  assert.match(source, /unofficial listening party table has no rows/);
});

test('visual audit flags clipped playlist tables even when document width fits', () => {
  assert.match(source, /playlistOverflow/);
  assert.match(source, /playlist table is horizontally clipped/);
  assert.match(source, /music-service-playlist-table/);
});


test('visual audit waits for leaderboard metadata and rendered rows before screenshot', () => {
  assert.match(source, /leaderboardMode/);
  assert.match(source, /leaderboardWaitTimedOut/);
  assert.match(source, /leaderboardCadence/);
  assert.match(source, /leaderboardTbody/);
  assert.match(source, /leaderboard data was not rendered within 20 seconds/);
  assert.match(source, /leaderboard metadata was not rendered/);
  assert.match(source, /leaderboard table has no rows/);
});

test('visual audit waits for lazy music-service charts and empty-state tables before screenshot', () => {
  assert.match(source, /serviceRenderWaitTimedOut/);
  assert.match(source, /activeServiceGroup/);
  assert.match(source, /music-service-group/);
  assert.match(source, /music-service-rank-chart/);
  assert.match(source, /body\.children\.length === 0/);
  assert.match(source, /music service subview did not finish rendering within 20 seconds/);
});


test('visual audit waits for Nogizaka listening-party data before screenshot', () => {
  assert.match(source, /nogizakaBroadcastMode/);
  assert.match(source, /nogizakaBroadcastWaitTimedOut/);
  assert.match(source, /broadcast-count/);
  assert.match(source, /broadcast-tbody/);
  assert.match(source, /Nogizaka listening-party data was not rendered within 20 seconds/);
  assert.match(source, /Nogizaka listening-party summary metrics remained placeholders/);
  assert.match(source, /Nogizaka listening-party table has no rows/);
});


test('visual audit captures every KKBOX category in both daily and weekly modes', () => {
  const route = auditRoutes().find(({ mode }) => mode === 'kkbox');
  const states = kkboxAuditRoutes(route);
  assert.equal(states.length, 8);
  assert.equal(new Set(states.map(({ panel }) => panel)).size, 8);
  assert.deepEqual(
    states.map(({ kkboxSelection }) => `${kkboxSelection.series}/${kkboxSelection.period}`).sort(),
    [
      'hk:newrelease/daily', 'hk:newrelease/weekly',
      'hk:song/daily', 'hk:song/weekly',
      'tw:newrelease/daily', 'tw:newrelease/weekly',
      'tw:song/daily', 'tw:song/weekly',
    ],
  );
  assert.ok(states.every(({ controls }) => controls.length === 2));
  assert.ok(states.some(({ controls }) => controls.includes('button[data-kkbox-period-filter="daily"]')));
  assert.ok(states.some(({ controls }) => controls.includes('button[data-kkbox-period-filter="weekly"]')));
});

test('visual audit verifies KKBOX category, period, chart and history state before capture', () => {
  assert.match(source, /kkboxWaitTimedOut/);
  assert.match(source, /data-kkbox-series-filter/);
  assert.match(source, /data-kkbox-period-filter/);
  assert.match(source, /kkboxJapaneseRankChart/);
  assert.match(source, /kkboxJapaneseHistoryBody/);
  assert.match(source, /KKBOX selected category does not match/);
  assert.match(source, /KKBOX selected period does not match/);
});
