import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const episode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const queue = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');

test('TVer advances only through the native cloud-owned episode queue', () => {
  assert.match(queue, /struct NativeMediaTverNativeQueueState/);
  assert.match(queue, /latestEpisodeIds/);
  assert.match(queue, /queueEpisodeIds/);
  assert.match(queue, /consumedEpisodeIds/);
  assert.match(queue, /NativeMediaTverAdvanceEpisode/);
  assert.match(wrapper, /message == L"homepanel:tver-ended"/);
  assert.match(wrapper, /NativeMediaTverAdvanceEpisode\(source\)/);
  assert.doesNotMatch(episode + wrapper, /__homePanelTverEpisodeQueue|sessionStorage/);
  assert.doesNotMatch(episode, /location\.replace\(/);
  assert.doesNotMatch(episode, /あなたにおすすめ|関連番組|ランキング|SeriesPath/);
});

test('TVer completed program waits for post-roll before native advancement', () => {
  assert.match(episode, /postrollGraceMs = 12000/);
  assert.match(episode, /completedItem = state\.maxDuration >= 5/);
  assert.match(episode, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(episode, /Date\.now\(\) - state\.endCandidateAt >= postrollGraceMs/);
  assert.match(episode, /postrollAfterProgram/);
  assert.match(episode, /postMessage\('homepanel:tver-ended'\)/);
  assert.match(episode, /endReported/);
});

test('TVer stale or unplayable pages fail forward under native control', () => {
  assert.match(queue, /kNativeMediaTverStartupTimeoutMs = 30ULL \* 1000ULL/);
  assert.match(queue, /NativeMediaTverMarkNavigationStarted/);
  assert.match(queue, /NativeMediaTverMarkMediaReady/);
  assert.match(queue, /NativeMediaTverStartupExpired/);
  assert.match(host, /NativeMediaTverStartupExpired\(source, now\)/);
  assert.match(host, /NativeMediaTverAdvanceEpisode\(source\)/);
  assert.doesNotMatch(queue, /document\.querySelectorAll|setTimeout|setInterval/);
});

test('TVer cloud refresh preserves the selected episode and consumed prefix natively', () => {
  assert.match(queue, /Never interrupt an episode that is already selected/);
  assert.match(queue, /NativeMediaTverContainsId\(state\.consumedEpisodeIds, id\)/);
  assert.match(queue, /state\.currentEpisodeId/);
  assert.match(queue, /state\.latestEpisodeIds/);
  assert.match(queue, /Queue exhaustion starts a fresh cycle/);
  assert.doesNotMatch(
    queue,
    /ExecuteScript\s*\(|sessionStorage\s*\.|location\.replace\s*\(/,
  );
});

test('TVer player observation remains bounded rather than document-wide', () => {
  assert.match(episode, /const bindPlayerObserver = video =>/);
  assert.match(episode, /playerObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(episode, /observe\(document\.documentElement/);
  assert.doesNotMatch(episode, /setInterval\(/);
});
