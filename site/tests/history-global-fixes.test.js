import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fixes = readFileSync(new URL('../public/history/history-global-fixes.js', import.meta.url), 'utf8');
const pageFixes = readFileSync(new URL('../public/history/history-page-fixes.js', import.meta.url), 'utf8');

test('shared history fixes load for current, history, and likes views', () => {
  assert.match(entry, /import '\.\/history\/history-global-fixes\.js'/);
  assert.match(fixes, /\.dashboard-view \.data-panel/);
  assert.match(fixes, /\.likes-view \.table-wrap/);
  assert.match(fixes, /content-visibility:\s*visible\s*!important/);
});

test('summary metrics remain single-line at intermediate desktop and tablet widths', () => {
  assert.match(fixes, /\.dashboard-view \.summary-cards strong/);
  assert.match(fixes, /white-space:\s*nowrap\s*!important/);
  assert.match(fixes, /font-size:\s*clamp\(1\.15rem,\s*1\.8vw,\s*1\.55rem\)/);
});

test('featured and single-host ranking summaries count host weeks from the returned timeline', () => {
  assert.match(pageFixes, /history:data-loaded/);
  assert.match(pageFixes, /setText\('periodLabel', '総週数'\)/);
  assert.match(pageFixes, /setText\('maxLabel', 'ランクイン週数'\)/);
  assert.match(pageFixes, /setText\('streamLabel', '圏外・欠測週数'\)/);
  assert.match(pageFixes, /const singleHost = Array\.isArray\(payload\?\.chart_hosts\) && payload\.chart_hosts\.length === 1/);
  assert.match(pageFixes, /rows\.map\(\(row\) => row\?\.ranking_date\)/);
  assert.match(pageFixes, /outWeeks: Math\.max\(0, totalWeeks - rankedWeeks\)/);
  assert.match(pageFixes, /value === null \|\| value === undefined \|\| value === ''/);
  assert.doesNotMatch(pageFixes, /weeklyRange|mondayOnOrAfter|WEEK_MS/);
  assert.doesNotMatch(pageFixes, /rows\.length - rankedCount/);
  assert.doesNotMatch(fixes, /function finiteRank|repairRankingSummary|rankingBody/);
});

test('all-host ranking summary uses aggregate leaderboard metrics', () => {
  assert.match(pageFixes, /setText\('periodLabel', '対象週数'\)/);
  assert.match(pageFixes, /setText\('maxLabel', '掲載ホスト数'\)/);
  assert.match(pageFixes, /setText\('streamLabel', '延べランクイン数'\)/);
  assert.match(pageFixes, /setText\('memberLabel', '圏外・欠測数'\)/);
  assert.match(pageFixes, /payload\.scope === 'all' && !singleSelectedHost/);
  assert.match(pageFixes, /summary\.ranked_entry_count/);
  assert.match(pageFixes, /summary\.out_of_rank_count/);
  assert.match(pageFixes, /メンバー増加数/);
});

test('current playback can recover missing labels from the track ranking projection', () => {
  assert.match(fixes, /ranking_only=1&ranking_limit=500/);
  assert.match(fixes, /spotifyTrackId/);
  assert.match(fixes, /repairPlaybackMetadata/);
});
