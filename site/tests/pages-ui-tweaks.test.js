import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tweaks = readFileSync(new URL('../public/pages-ui-tweaks.js', import.meta.url), 'utf8');
const finalFixes = readFileSync(new URL('../public/pages-layout-final-fixes.css', import.meta.url), 'utf8');

test('Pages UI tweaks load before the dashboard runtime', () => {
  assert.match(entry, /pages-ui-tweaks\.js\?v=20260921\.1/);
});

test('current chart moves before now playing and drops its heading block', () => {
  assert.match(tweaks, /primaryGrid\.before\(chartCard\)/);
  assert.match(tweaks, /headingBlock\?\.querySelector\('h2'\)/);
  assert.match(tweaks, /headingBlock\.remove\(\)/);
});

test('likes update stays hidden while CSV moves to the song table header', () => {
  assert.match(tweaks, /likesLoad\.replaceWith\(hook\)/);
  assert.match(tweaks, /panel\.querySelector\('#likesTbody'\)/);
  assert.match(tweaks, /likesTableHead\.append\(likesCsv\)/);
  assert.match(tweaks, /if \(!likeActions\.childElementCount\) likeActions\.remove\(\)/);
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
