import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const spotify = readFileSync(new URL('../public/spotify.css', import.meta.url), 'utf8');
const firstWeek = readFileSync(new URL('../public/first-week-comparison.css', import.meta.url), 'utf8');
const playedTracks = readFileSync(new URL('../public/played-tracks.css', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const presentation = readFileSync(new URL('../public/dashboard-root-presentation.css', import.meta.url), 'utf8');

test('canonical layout does not target individual dashboard view IDs', () => {
  assert.doesNotMatch(layout, /#(?:current|history|likes|spotify|firstWeek|playedTracks)View/);
});

test('feature styles do not reimplement dashboard view spacing or mobile fit tables', () => {
  for (const [name, source] of Object.entries({ spotify, firstWeek, playedTracks })) {
    assert.doesNotMatch(source, /\.dashboard-view\s*\{|\.\w+-view\s*\{[\s\S]{0,80}margin-top:/, `${name} must not own view spacing`);
    assert.doesNotMatch(source, /table-fit-mobile|#likesView|#historyView/, `${name} must not own shared table fitting`);
  }
});

test('history rendering does not inject CSS and static corrections live in a stylesheet', () => {
  assert.doesNotMatch(history, /createElement\('style'\)|style\.textContent|MOBILE_TABLE_STYLE_ID/);
  assert.match(presentation, /\.dashboard-view \.data-panel/);
  assert.match(presentation, /#historyView \.summary-cards strong/);
});
