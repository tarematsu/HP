import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const likesShell = readFileSync(new URL('../public/likes-shell.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');

test('history no longer loads a post-render UI tweak runtime', () => {
  assert.doesNotMatch(historyEntry, /pages-ui-tweaks/);
  assert.doesNotMatch(entry, /pages-ui-tweaks/);
});

test('shared current chart is statically before now playing without a redundant heading block', () => {
  const currentPanel = stationheadShell.indexOf('data-stationhead-panel="current"');
  const chartIndex = stationheadShell.indexOf('class="card chart-card chart-panel"', currentPanel);
  const playbackIndex = stationheadShell.indexOf('${playbackCards()}', chartIndex);
  assert.ok(currentPanel >= 0 && chartIndex > currentPanel && playbackIndex > chartIndex);
  const chartCard = stationheadShell.slice(chartIndex, playbackIndex);
  assert.doesNotMatch(chartCard, /LAST 24 HOURS|オンライン数<\/h2>/);
  assert.match(stationheadShell, /class="primary-grid"/);
});

test('likes update control is removed and CSV stays in the song-table shared data card', () => {
  assert.doesNotMatch(likesShell, /id="likesLoad"|class="like-actions"/);
  const tablePanel = likesShell.slice(likesShell.indexOf("title: '楽曲別一覧'"));
  assert.ok(tablePanel.length > 0);
  assert.match(tablePanel, /id="likesCsv"/);
  assert.match(likesShell, /dashboardDataCard/);
});

test('mobile ranking metric layout is shared instead of scoped to the likes tab', () => {
  assert.match(sharedLayout, /grid-template-columns:\s*28px 38px minmax\(0, 1fr\) minmax\(60px, auto\) !important/);
  assert.match(sharedLayout, /\.like-rank-metrics\s*\{[\s\S]*grid-column:\s*4 !important/);
  assert.match(sharedLayout, /\.like-rank-metrics span\s*\{[\s\S]*text-align:\s*right !important/);
  assert.doesNotMatch(sharedLayout, /#likesView \.like-rank/);
});

test('official listening-party labels normalize the leading date before cell text is rendered', () => {
  assert.match(history, /const OFFICIAL_EVENT_DATE_GAP/);
  assert.match(history, /key === 'event_name'/);
  assert.match(history, /String\(value\)\.replace\(OFFICIAL_EVENT_DATE_GAP, '\$1'\)/);
  assert.doesNotMatch(history, /createTreeWalker|queueMicrotask\(.*normalizeOfficialEventText|MutationObserver/);
  const normalize = (value) => value.replace(/(\d{4}[./-]\d{1,2}[./-]\d{1,2})[ \u3000]+(?=『)/g, '$1');
  assert.equal(
    normalize('2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』'),
    '2026.09.21『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』',
  );
});
