import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const episode = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url), 'utf8');
const refresh = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');

test('TVer advances only through the single cloud-owned episode queue', () => {
  assert.match(episode, /episodeQueueKey = '__homePanelTverEpisodeQueue'/);
  assert.doesNotMatch(episode, /__homePanelTverEpisodeQueue:/);
  assert.match(episode, /const advanceEpisode = \(\) =>/);
  assert.match(episode, /nextIndex < queue\.hrefs\.length/);
  assert.match(episode, /location\.replace\(queue\.hrefs\[nextIndex\]\)/);
  assert.match(refresh, /const queueKey = '__homePanelTverEpisodeQueue'/);
  assert.match(refresh, /const fresh = \[/);
  assert.match(refresh, /prefix\.concat\(remaining\)/);
  assert.doesNotMatch(episode, /あなたにおすすめ|関連番組|ランキング|SeriesPath/);
});

test('TVer completed program waits for post-roll before advancing', () => {
  assert.match(episode, /postrollGraceMs = 12000/);
  assert.match(episode, /completedItem = state\.maxDuration >= 5/);
  assert.match(episode, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(episode, /Date\.now\(\) - state\.endCandidateAt >= postrollGraceMs/);
  assert.match(episode, /postrollAfterProgram/);
  assert.match(
    episode,
    /if \(completedPostroll\)[\s\S]*advanceEpisode\(\)[\s\S]*restartRequested = true/,
  );
});

test('TVer skips cloud-stale and unplayable episode pages', () => {
  assert.match(refresh, /const currentStillFresh = freshEpisodes\.some/);
  assert.match(refresh, /const resumeEpisodes = freshEpisodes\.filter/);
  assert.match(refresh, /location\.replace\(resumeEpisodes\[0\]\)/);
  assert.match(refresh, /const missingVideoGuardMs = 30000/);
  assert.match(refresh, /document\.querySelectorAll\('video'\)/);
  assert.match(refresh, /video\.readyState >= 1 \|\| duration > 0/);
  assert.match(refresh, /nextIndex < latestHrefs\.length/);
  assert.match(refresh, /location\.replace\(latestHrefs\[nextIndex\]\)/);
  assert.match(refresh, /sessionStorage\.removeItem\(queueKey\)/);
  assert.match(refresh, /postMessage\('homepanel:tver-wake'\)/);
  assert.doesNotMatch(refresh, /setInterval\(/);
});

test('TVer reapplies the cached validity guard after episode navigation', () => {
  assert.match(refresh, /std::optional<NativeMediaTverCloudQueueRefreshResult> cached/);
  assert.match(refresh, /std::wstring appliedSource/);
  assert.match(refresh, /source == state\.appliedSource/);
  assert.match(refresh, /else if \(state\.cached\)/);
  assert.match(refresh, /ready = state\.cached/);
  assert.match(refresh, /shared\.cached = result/);
});

test('TVer player observation is bounded rather than document-wide', () => {
  assert.match(episode, /const bindPlayerObserver = video =>/);
  assert.match(episode, /playerObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(episode, /observe\(document\.documentElement/);
  assert.doesNotMatch(episode, /setInterval\(/);
});
