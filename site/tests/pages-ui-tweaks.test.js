import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tweaks = readFileSync(new URL('../public/pages-ui-tweaks.js', import.meta.url), 'utf8');
const finalFixes = readFileSync(new URL('../public/pages-layout-final-fixes.css', import.meta.url), 'utf8');

test('Pages UI tweaks load before the dashboard runtime', () => {
  assert.match(entry, /pages-ui-tweaks\.js\?v=20260924\.1/);
});

test('current chart is statically before now playing without a redundant heading block', () => {
  assert.ok(page.indexOf('class="card chart-card"') < page.indexOf('class="primary-grid"'));
  const chartCard = page.slice(page.indexOf('class="card chart-card"'), page.indexOf('class="primary-grid"'));
  assert.doesNotMatch(chartCard, /LAST 24 HOURS|オンライン数<\/h2>/);
  assert.doesNotMatch(tweaks, /primaryGrid|chartCard|headingBlock|\.before\(|\.remove\(/);
});

test('likes update control is removed and CSV is statically in the song table header', () => {
  assert.doesNotMatch(page, /id="likesLoad"|class="like-actions"/);
  const tablePanel = page.slice(page.indexOf('<h2>楽曲別一覧</h2>'));
  assert.match(tablePanel, /id="likesCsv"/);
  assert.doesNotMatch(tweaks, /likesLoad|likesCsv|likeActions|replaceWith|append\(/);
});

test('mobile likes ranking keeps the latest-like metric to the right of track metadata', () => {
  assert.match(finalFixes, /grid-template-columns: 28px 38px minmax\(0, 1fr\) minmax\(60px, auto\) !important/);
  assert.match(finalFixes, /#likesView \.like-rank-metrics \{[\s\S]*grid-column: 4 !important/);
  assert.match(finalFixes, /#likesView \.like-rank-metrics span \{[\s\S]*text-align: right !important/);
});

test('official listening-party labels remove the gap after a leading date after explicit renders', () => {
  assert.match(tweaks, /OFFICIAL_EVENT_DATE_GAP/);
  assert.match(tweaks, /history:data-loaded/);
  assert.match(tweaks, /getElementById\('more'\)\?\.addEventListener/);
  assert.doesNotMatch(tweaks, /MutationObserver/);
  const normalize = (value) => value.replace(/(\d{4}[./-]\d{1,2}[./-]\d{1,2})[ \u3000]+(?=『)/g, '$1');
  assert.equal(
    normalize('2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』'),
    '2026.09.21『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』',
  );
});
