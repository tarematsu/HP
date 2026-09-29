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
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const youtubePolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url), 'utf8');
const xRuntime = readFileSync(
  new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url), 'utf8');

test('startup runs X for one minute before a full YouTube hour', () => {
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs = 1U \* 60U \* 1000U/);
  assert.match(mediaBase, /https:\/\/x\.com\/home\?homepanel=startup/);
  assert.match(mediaBase, /NativeMediaStartupYoutubePhaseActive/);
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs \+ kNativeMediaYoutubePhaseMs/);
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs \+ kNativeMediaYoutubeContentPhaseMs/);
  assert.match(xRuntime, /homepanel:startup-x-until:v2/);
  assert.match(xRuntime, /homepanel=startup/);
  assert.match(xRuntime, /Date\.now\(\) \+ 60 \* 1000/);
  assert.match(xRuntime, /location\.assign\(youtubeStart\)/);
});

test('YouTube hands its final minute to X after 60 minutes', () => {
  assert.match(mediaBase, /kNativeMediaYoutubeContentPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaXPhaseMs = 1U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubePhaseMs =[\s\S]*kNativeMediaYoutubeContentPhaseMs \+ kNativeMediaXPhaseMs/);
  assert.doesNotMatch(youtubePolicy, /media_youtube_x_transition/);
  assert.match(host, /ArmTimer\(kNativeMediaXStartTimer, xRemaining\)/);
  assert.match(host, /Navigate\(L"https:\/\/x\.com\/home"\)/);
});

test('TVer runs 58 minutes and hands its final minute to X', () => {
  assert.match(mediaBase, /kNativeMediaTverContentDurationMs = 58U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaTverPhaseMs =[\s\S]*kNativeMediaTverContentDurationMs \+ kNativeMediaXPhaseMs/);
  assert.match(tverQueue, /kNativeMediaTverContentPhaseMs = 58ULL \* 60ULL \* 1000ULL/);
  assert.match(tverQueue, /ULONGLONG phaseStartedAt = 0/);
  assert.match(tverQueue, /NativeMediaTverXPhaseActive\(\)/);
  assert.doesNotMatch(tverRuntime, /homepanel:tver-x-phase-start/);
  assert.match(host, /phase_ == Phase::Tver[\s\S]*kNativeMediaTverContentDurationMs/);
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
  assert.match(xRuntime, /while \(!tab && performance\.now\(\) < deadline\)/);
  assert.match(xRuntime, /state\.result = 'waiting-login'/);
  assert.match(xRuntime, /await sleep\(1000\)/);
  assert.doesNotMatch(xRuntime, /attempt < \d+ && !tab/);
  const waitStart = xRuntime.indexOf('let tab = followingTab()');
  const authEnd = xRuntime.indexOf("state.result = 'authenticated'", waitStart);
  const waiting = xRuntime.slice(waitStart, authEnd);
  assert.doesNotMatch(waiting, /scrollTo\(|scrollBy\(/);
});

test('X likes use the same DOM click style as the Following tab and retry until confirmed', () => {
  assert.match(xRuntime, /\^\(\?:Following\|フォロー中\)\$/);
  assert.match(xRuntime, /tab\.click\(\)/);
  assert.match(xRuntime, /const clickLikeButton = button =>/);
  assert.match(xRuntime, /button\.click\(\)/);
  assert.match(xRuntime, /const likeIntervalMs = 10 \* 1000/);
  assert.match(xRuntime, /const likeRetryIntervalMs = 1800/);
  assert.match(xRuntime, /const maxLikeAttemptsPerPost = 3/);
  assert.match(xRuntime, /querySelector\('\[data-testid="unlike"\]'\)/);
  assert.match(xRuntime, /state\.result = 'like-clicked'/);
  assert.match(xRuntime, /state\.result = 'like-confirmed'/);
  assert.match(xRuntime, /state\.result = 'like-unconfirmed'/);
  assert.match(xRuntime, /failedAttempts\.set\(candidate\.id, failures\)/);
  assert.match(xRuntime, /failures >= maxLikeAttemptsPerPost/);
  assert.doesNotMatch(xRuntime, /homepanel:x-like:/);
});

test('X timeline CSS only hides classified repost/promotion rows and placement ads', () => {
  assert.match(xRuntime, /homepanel-x-timeline-filter/);
  assert.match(xRuntime, /data-homepanel-x-filtered/);
  assert.match(xRuntime, /article\[data-testid="tweet"\]:has\(\[data-testid\*="placement" i\]\)/);
  assert.match(xRuntime, /display:\s*none !important/);
  assert.match(xRuntime, /markFilteredArticles\(\)/);
  assert.doesNotMatch(xRuntime, /article\[data-testid="tweet"\]:has\(\[data-testid="socialContext"\]\)/);
  assert.doesNotMatch(xRuntime, /cellInnerDiv[^`]*socialContext/);
  assert.doesNotMatch(xRuntime, /const promotedText/);
  assert.match(xRuntime, /!element\.closest\?\.\('\[data-testid="tweetText"\]'\)/);
});
