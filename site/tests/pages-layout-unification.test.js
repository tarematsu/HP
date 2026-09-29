import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const spotifyShell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const firstWeekShell = readFileSync(new URL('../public/first-week-comparison-shell.js', import.meta.url), 'utf8');
const playedTracksShell = readFileSync(new URL('../public/played-tracks-shell.js', import.meta.url), 'utf8');
const historyCleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');

test('one canonical cross-view stylesheet owns dashboard layout', () => {
  assert.match(header, /pages-layout\.css\?v=20260928\.1/);
  assert.doesNotMatch(header, /pages-layout-unification|pages-layout-final-fixes/);
  assert.ok(
    header.indexOf('currentEnhancementsHref') < header.indexOf('pagesLayoutHref'),
    'shared layout must load after feature refinements',
  );
});

test('every dashboard view uses one grid rhythm without per-tab margins', () => {
  assert.match(css, /\.dashboard-view\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*var\(--pages-view-gap\)/);
  assert.match(css, /\.dashboard-view > \*\s*\{[\s\S]*margin-top:\s*0 !important/);
  assert.match(css, /--pages-view-gap:\s*12px/);
  assert.match(css, /--pages-view-gap-mobile:\s*8px/);
  assert.doesNotMatch(css, /#(?:current|history|likes|spotify|firstWeek|playedTracks)View/);
});

test('summary cards derive columns from their item count rather than tab identity', () => {
  assert.match(css, /\.summary-cards:has\(> :nth-child\(3\):last-child\)[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.summary-cards:has\(> :nth-child\(4\):last-child\)[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /likes-summary\s*\{/);
  assert.doesNotMatch(css, /spotify-summary\s*\{/);
  assert.doesNotMatch(css, /played-tracks-summary\s*\{/);
});

test('toolbars, fitting tables and fitting charts use shared semantic utilities', () => {
  assert.match(css, /\.view-toolbar\s*\{/);
  assert.match(css, /\.table-wrap\.table-fit-mobile/);
  assert.match(css, /\.table-fit-mobile > table[\s\S]*table-layout:\s*fixed !important/);
  assert.match(css, /\.chart-fit > :is\(svg, canvas\)/);
  assert.doesNotMatch(firstWeekShell, /view-toolbar first-week-toolbar|data-first-week-metric/);
  assert.match(playedTracksShell, /view-toolbar played-tracks-toolbar/);
  assert.match(spotifyShell, /table-wrap table-fit-mobile/);
});

test('history cleanup changes table meaning only and injects no layout CSS', () => {
  assert.match(historyCleanup, /classList\.toggle\('compact-columns', mode === 'ranking'\)/);
  assert.match(historyCleanup, /classList\.toggle\('official-party-table', mode === 'broadcasts'\)/);
  assert.doesNotMatch(historyCleanup, /createElement\('style'\)|MOBILE_TABLE_STYLE_ID|installMobileTableWidthStyle/);
});

test('mobile navigation remains one row and shared layout handles wide-table exceptions by class', () => {
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs[\s\S]*repeat\(8, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*grid-template-rows:\s*minmax\(44px, auto\)/);
  assert.match(css, /table\.compact-columns:not\(\.all-host-ranking-table\)[\s\S]*min-width:\s*760px !important/);
  assert.match(css, /table\.all-host-ranking-table\.compact-columns[\s\S]*min-width:\s*980px !important/);
  assert.match(css, /table\.weekly-ranking-table[\s\S]*min-width:\s*560px !important/);
});
