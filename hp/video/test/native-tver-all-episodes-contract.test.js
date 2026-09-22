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
  assert.match(queue, /rejectedEpisodeIds/);
  assert.match(queue, /NativeMediaTverAdvanceEpisode/);
  assert.match(wrapper, /message == L"homepanel:tver-ended"/);
  assert.match(wrapper, /NativeMediaTverAdvanceEpisode\(source\)/);
  assert.doesNotMatch(episode + wrapper, /__homePanelTverEpisodeQueue|sessionStorage/);
  assert.doesNotMatch(episode, /location\.replace\(/);
  assert.doesNotMatch(episode, /あなたにおすすめ|関連番組|ランキング|SeriesPath/);
});

test('TVer completed program waits for stable post-roll before native advancement', () => {
  assert.match(episode, /postrollGraceMs = 12000/);
  assert.match(episode, /completedItem = state\.programPlaybackConfirmed &&/);
  assert.match(episode, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(episode, /mediaIdentity\(video\) === state\.endCandidateIdentity/);
  assert.match(episode, /Date\.now\(\) - state\.endCandidateAt >= postrollGraceMs/);
  assert.match(episode, /postrollAfterProgram/);
  assert.match(episode, /postMessage\('homepanel:tver-ended'\)/);
  assert.match(episode, /endReported/);
});

test('TVer startup failures reload the same episode without a fail-forward limit', () => {
  assert.match(queue, /kNativeMediaTverStartupTimeoutMs = 30ULL \* 1000ULL/);
  assert.doesNotMatch(queue, /kNativeMediaTverStartupTimeoutLimit|startupTimeoutCount/);
  assert.match(queue, /startupReloadPending = false/);
  assert.match(queue, /NativeMediaTverMarkNavigationStarted/);
  assert.match(queue, /NativeMediaTverMarkMediaReady/);
  assert.match(queue, /NativeMediaTverStartupExpired/);
  assert.match(queue, /state\.startupReloadPending = true;\s*return true;/);
  assert.match(queue, /if \(state\.startupReloadPending\)/);
  assert.match(host, /NativeMediaTverStartupExpired\(source, now\)/);
  assert.match(host, /NativeMediaTverAdvanceEpisode\(source\)/);
  assert.doesNotMatch(queue, /document\.querySelectorAll|setTimeout|setInterval/);
});

test('TVer stale or redirected pages cannot consume the current queue item', () => {
  assert.match(queue, /!NativeMediaTverSourceMatchesEpisode\(source, state\.currentEpisodeId\)/);
  assert.match(
    queue,
    /A redirect or stale page is a recovery condition[\s\S]*state\.startupReloadPending = true;\s*return true;/,
  );
  const recovery = queue.indexOf('if (state.startupReloadPending)');
  const staleGuard = queue.indexOf('if (!sourceMatches) return false;');
  assert.ok(recovery >= 0 && staleGuard > recovery);
  assert.match(queue, /if \(!sourceMatches\) return false;/);
});

test('TVer only rejects a removed current item when an explicit matching end advances it', () => {
  assert.match(queue, /if \(missingFromLatest\) \{/);
  assert.match(queue, /state\.rejectedEpisodeIds\.push_back\(state\.currentEpisodeId\)/);
  assert.match(queue, /NativeMediaTverContainsId\(state\.rejectedEpisodeIds, id\)/);
  assert.match(
    queue,
    /if \(!NativeMediaTverContainsId\(state\.rejectedEpisodeIds, id\)\) \{\s*rebuilt\.push_back\(id\);/,
  );
  assert.match(queue, /state\.rejectedEpisodeIds\.clear\(\)/);
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
