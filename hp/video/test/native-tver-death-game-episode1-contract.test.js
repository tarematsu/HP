import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);

test('Death Youth Game prefers episode 1 over preview or PR', () => {
  assert.match(composition, /seriesPath === deathGameSeriesPath/);
  assert.match(composition, /const isPreview = link/);
  assert.match(composition, /links\.find\(link => !isPreview\(link\)\)/);
  assert.match(composition, /const previewMode = false/);
  assert.match(composition, /completedEpisode = !state\.previewMode/);
});
