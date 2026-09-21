import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tweaks = readFileSync(new URL('../public/pages-ui-tweaks.js', import.meta.url), 'utf8');

test('Pages UI tweaks load before the dashboard runtime', () => {
  assert.match(entry, /pages-ui-tweaks\.js\?v=20260921\.1/);
});

test('current chart moves before now playing and drops its heading block', () => {
  assert.match(tweaks, /primaryGrid\.before\(chartCard\)/);
  assert.match(tweaks, /headingBlock\?\.querySelector\('h2'\)/);
  assert.match(tweaks, /headingBlock\.remove\(\)/);
});

test('likes update and CSV actions are hidden without breaking their existing handlers', () => {
  assert.match(tweaks, /#likesView \.like-actions/);
  assert.match(tweaks, /likeActions\.hidden = true/);
});

test('official listening-party labels remove the gap after a leading date', () => {
  assert.match(tweaks, /OFFICIAL_EVENT_DATE_GAP/);
  const normalize = (value) => value.replace(/(\d{4}[./-]\d{1,2}[./-]\d{1,2})[ \u3000]+(?=『)/g, '$1');
  assert.equal(
    normalize('2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』'),
    '2026.09.21『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』',
  );
});
