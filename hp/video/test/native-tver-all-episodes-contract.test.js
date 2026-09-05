import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);

test('TVer cycles every published series item before switching series', () => {
  assert.match(composition, /episodeQueueKey = seriesPath/);
  assert.match(composition, /__homePanelTverEpisodeQueue:/);
  assert.doesNotMatch(composition, /isMainEpisodeLink/);
  assert.match(composition, /const findSeriesEpisodeContainer = \(\) =>/);
  assert.match(composition, /if \(!episodeHeading\) return null/);
  assert.match(composition, /あなたにおすすめ\|おすすめ\|関連番組\|関連動画\|ランキング/);
  assert.match(composition, /if \(!container\) return/);
  assert.match(composition, /container\.querySelectorAll\('a\[href\*=\"\/episodes\/\"\]'\)/);
  assert.doesNotMatch(composition, /if \(!recommendationHeading\) return true/);
  assert.match(composition, /Array\.from\(new Set\(/);
  assert.match(composition, /writeEpisodeQueue\(seriesPath, hrefs, 0\)/);
  assert.match(composition, /const advanceEpisodeOrSeries = \(\) =>/);
  assert.match(composition, /nextIndex < queue\.hrefs\.length/);
  assert.match(composition, /location\.replace\(queue\.hrefs\[nextIndex\]\)/);
  assert.match(composition, /clearEpisodeQueue\(seriesPath\)/);
});

test('TVer short items wait out ad transitions before advancing', () => {
  assert.match(composition, /completedItem = state\.maxDuration >= 5/);
  assert.match(composition, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(composition, /stableEndDelayMs = state\.maxDuration < 600 \? 8000 : 2500/);
  assert.match(composition, /Date\.now\(\) - state\.endCandidateAt >= stableEndDelayMs/);
  assert.match(
    composition,
    /stableEnd && completedItem[\s\S]*advanceEpisodeOrSeries\(\)[\s\S]*state\.restartRequested = true/,
  );
});
