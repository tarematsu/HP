import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const hostWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url), 'utf8');
const tverQueue = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');
const tverRuntime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const youtubeTransition = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_x_transition.inc', import.meta.url), 'utf8');
const youtubePolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url), 'utf8');
const xRuntime = readFileSync(
  new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url), 'utf8');

test('YouTube hands its final minute to X after 60 minutes', () => {
  assert.match(mediaBase, /kNativeMediaYoutubeContentPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaXPhaseMs = 1U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubePhaseMs =[\s\S]*kNativeMediaYoutubeContentPhaseMs \+ kNativeMediaXPhaseMs/);
  assert.match(youtubePolicy, /#include "media_youtube_x_transition\.inc"/);
  assert.match(youtubeTransition, /const phaseMs = 60 \* 60 \* 1000/);
  assert.match(youtubeTransition, /location\.assign\('https:\/\/x\.com\/home'\)/);
});

test('TVer runs 58 minutes and hands its final minute to X', () => {
  assert.match(mediaBase, /kNativeMediaTverContentDurationMs = 58U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaTverPhaseMs =[\s\S]*kNativeMediaTverContentDurationMs \+ kNativeMediaXPhaseMs/);
  assert.match(tverQueue, /kNativeMediaTverContentPhaseMs = 58ULL \* 60ULL \* 1000ULL/);
  assert.match(tverQueue, /ULONGLONG phaseStartedAt = 0/);
  assert.match(tverQueue, /NativeMediaTverXPhaseActive\(\)/);
  assert.match(tverRuntime, /const phaseMs = 58 \* 60 \* 1000/);
  assert.match(tverRuntime, /location\.assign\('https:\/\/x\.com\/home'\)/);
});

test('TVer recovery cannot pull the shared WebView back from the X subphase', () => {
  assert.match(
    hostWindow,
    /timerId == kNativeMediaTverWatchdogTimer[\s\S]*timerId == kNativeMediaNavigationRetryTimer[\s\S]*NativeMediaTverXPhaseActive\(\)/,
  );
  assert.match(hostWindow, /KillTimer\(hwnd, timerId\)/);
});

test('X waits without interaction until the authenticated Following tab exists', () => {
  assert.match(xRuntime, /let tab = followingTab\(\)/);
  assert.match(xRuntime, /while \(!tab\)/);
  assert.match(xRuntime, /state\.result = 'waiting-login'/);
  assert.match(xRuntime, /await sleep\(1000\)/);
  assert.doesNotMatch(xRuntime, /attempt < \d+ && !tab/);
  const waitStart = xRuntime.indexOf('let tab = followingTab()');
  const authEnd = xRuntime.indexOf("state.result = 'authenticated'", waitStart);
  const waiting = xRuntime.slice(waitStart, authEnd);
  assert.doesNotMatch(waiting, /scrollTo\(|scrollBy\(/);
});

test('X likes exclude reposts, ads and boosted posts', () => {
  assert.match(xRuntime, /\^\(\?:Following\|フォロー中\)\$/);
  assert.match(xRuntime, /Promoted\|Sponsored\|広告\|プロモーション\|スポンサー\|Boosted\|ブースト/);
  assert.match(xRuntime, /data-testid="socialContext"/);
  assert.match(xRuntime, /reposted\|repost\|retweeted\|retweet\|リポスト\|リツイート/);
  assert.match(xRuntime, /isOrganic = article => !isPromoted\(article\) && !isRepost\(article\)/);
  assert.match(xRuntime, /window\.scrollBy\(\{ top: scrollDistance, behavior: 'smooth' \}\)/);
  assert.match(xRuntime, /await sleep\(1800 \+ Math\.floor\(Math\.random\(\) \* 1400\)\)/);
  assert.match(xRuntime, /button\.click\(\)/);
  assert.doesNotMatch(xRuntime, /homepanel:startup-x-until|homepanel=startup/);
});
