import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tverStatic = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
  'utf8',
);

test('TVer cycles every published series item before switching series', () => {
  assert.match(tverStatic, /episodeQueueKey = seriesPath/);
  assert.match(tverStatic, /__homePanelTverEpisodeQueue:/);
  assert.doesNotMatch(tverStatic, /isMainEpisodeLink/);
  assert.match(tverStatic, /const findSeriesEpisodeContainer = \(\) =>/);
  assert.match(tverStatic, /if \(!episodeHeading\) return null/);
  assert.match(tverStatic, /あなたにおすすめ\|おすすめ\|関連番組\|関連動画\|ランキング/);
  assert.match(tverStatic, /if \(!container\) return/);
  assert.match(tverStatic, /container\.querySelectorAll\('a\[href\*=\"\/episodes\/\"\]'\)/);
  assert.doesNotMatch(tverStatic, /if \(!recommendationHeading\) return true/);
  assert.match(tverStatic, /Array\.from\(new Set\(/);
  assert.match(tverStatic, /writeEpisodeQueue\(seriesPath, hrefs, 0\)/);
  assert.match(tverStatic, /const advanceEpisodeOrSeries = \(\) =>/);
  assert.match(tverStatic, /nextIndex < queue\.hrefs\.length/);
  assert.match(tverStatic, /location\.replace\(queue\.hrefs\[nextIndex\]\)/);
  assert.match(tverStatic, /clearEpisodeQueue\(seriesPath\)/);
});

test('TVer short items wait out ad transitions before advancing', () => {
  assert.match(tverStatic, /completedItem = state\.maxDuration >= 5/);
  assert.match(tverStatic, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(tverStatic, /stableEndDelayMs = state\.maxDuration < 600 \? 8000 : 2500/);
  assert.match(tverStatic, /Date\.now\(\) - state\.endCandidateAt >= stableEndDelayMs/);
  assert.match(
    tverStatic,
    /stableEnd && completedItem[\s\S]*advanceEpisodeOrSeries\(\)[\s\S]*state\.restartRequested = true/,
  );
  assert.match(tverStatic, /state\.adActive/);
  assert.match(tverStatic, /state\.adIdentity/);
});
