import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);

test('TVer cycles every published main episode before switching series', () => {
  assert.match(composition, /episodeQueueKey = seriesPath/);
  assert.match(composition, /__homePanelTverEpisodeQueue:/);
  assert.match(
    composition,
    /放課後トーク\|予告\|\\bPR\\b\|ティザー\|teaser\|trailer\|ダイジェスト\|番宣\|告知/i,
  );
  assert.match(composition, /Array\.from\(new Set\(/);
  assert.match(composition, /writeEpisodeQueue\(seriesPath, hrefs, 0\)/);
  assert.match(composition, /const advanceEpisodeOrSeries = \(\) =>/);
  assert.match(composition, /nextIndex < queue\.hrefs\.length/);
  assert.match(composition, /location\.replace\(queue\.hrefs\[nextIndex\]\)/);
  assert.match(composition, /clearEpisodeQueue\(seriesPath\)/);
  assert.match(
    composition,
    /stableEnd && \(completedPreview \|\| completedEpisode\)[\s\S]*advanceEpisodeOrSeries\(\)[\s\S]*state\.restartRequested = true/,
  );
});
