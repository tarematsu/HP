import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const episode = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url), 'utf8');
const refresh = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');

test('TVer advances only through the cloud-owned episode queue', () => {
  assert.match(episode, /episodeQueueKey = seriesPath/);
  assert.match(episode, /__homePanelTverEpisodeQueue:/);
  assert.match(episode, /const advanceEpisodeOrSeries = \(\) =>/);
  assert.match(episode, /nextIndex < queue\.hrefs\.length/);
  assert.match(episode, /location\.replace\(queue\.hrefs\[nextIndex\]\)/);
  assert.match(refresh, /const fresh = \[/);
  assert.match(refresh, /prefix\.concat\(remaining\)/);
  assert.doesNotMatch(episode, /あなたにおすすめ|関連番組|ランキング/);
});

test('TVer completed program waits for post-roll before advancing', () => {
  assert.match(episode, /postrollGraceMs = 12000/);
  assert.match(episode, /completedItem = state\.maxDuration >= 5/);
  assert.match(episode, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(episode, /Date\.now\(\) - state\.endCandidateAt >= postrollGraceMs/);
  assert.match(episode, /postrollAfterProgram/);
  assert.match(
    episode,
    /if \(completedPostroll\)[\s\S]*advanceEpisodeOrSeries\(\)[\s\S]*restartRequested = true/,
  );
});

test('TVer player observation is bounded rather than document-wide', () => {
  assert.match(episode, /const bindPlayerObserver = video =>/);
  assert.match(episode, /playerObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(episode, /observe\(document\.documentElement/);
  assert.doesNotMatch(episode, /setInterval\(/);
});
