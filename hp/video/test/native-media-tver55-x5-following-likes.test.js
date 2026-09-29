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

test('media cycle randomly selects zero, one or two X slots once per X-YouTube-X-TVer cycle', () => {
  assert.match(mediaBase, /struct NativeMediaXCyclePlan/);
  assert.match(mediaBase, /const UINT count = NativeMediaXRandomBelow\(3\)/);
  assert.match(mediaBase, /if \(count == 2\)[\s\S]*firstSlot = true[\s\S]*secondSlot = true/);
  assert.match(mediaBase, /else if \(count == 1\)[\s\S]*NativeMediaXRandomBelow\(2\)/);
  assert.match(mediaBase, /if \(tver\) NativeMediaCurrentXCyclePlan\(\) = NativeMediaDrawXCyclePlan\(\)/);
  assert.match(mediaBase, /NativeMediaXSlotEnabled\(true\)/);
  assert.match(mediaBase, /NativeMediaXSlotEnabled\(false\)/);
});

test('unused X slots keep the fixed cycle length by continuing the current media', () => {
  assert.match(mediaBase, /return phaseDuration \+ 1000U/);
  assert.match(mediaBase, /return kNativeMediaTverPhaseMs \+ 1000U/);
  assert.match(mediaBase, /#define kNativeMediaYoutubeContentPhaseMs NativeMediaYoutubeContentIntervalMs\(\)/);
  assert.match(mediaBase, /#define kNativeMediaTverContentDurationMs NativeMediaTverContentIntervalMs\(\)/);
  assert.match(mediaBase, /gNativeMediaPowerSaving \|\| !NativeMediaXSlotEnabled\(true\)/);
});

test('startup reserves the first X slot before a full YouTube hour when selected', () => {
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs = 1U \* 60U \* 1000U/);
  assert.match(mediaBase, /https:\/\/x\.com\/home\?homepanel=startup/);
  assert.match(mediaBase, /NativeMediaStartupYoutubePhaseActive/);
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs \+ kNativeMediaYoutubePhaseMs/);
  assert.match(mediaBase, /startupPrefix \+ kNativeMediaYoutubeContentPhaseMs/);
  assert.match(xRuntime, /homepanel:startup-x-until:v2/);
  assert.match(xRuntime, /homepanel=startup/);
  assert.match(xRuntime, /Date\.now\(\) \+ 60 \* 1000/);
  assert.match(xRuntime, /location\.assign\(youtubeStart\)/);
});

test('YouTube can hand its final minute to the selected second X slot', () => {
  assert.match(mediaBase, /kNativeMediaYoutubeContentPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaXPhaseMs = 1U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubePhaseMs =[\s\S]*kNativeMediaYoutubeContentPhaseMs \+ kNativeMediaXPhaseMs/);
  assert.doesNotMatch(youtubePolicy, /media_youtube_x_transition/);
  assert.match(host, /ArmTimer\(kNativeMediaXStartTimer, xRemaining\)/);
  assert.match(host, /Navigate\(L"https:\/\/x\.com\/home"\)/);
});

test('TVer runs 58 minutes before a selected first X slot', () => {
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

test('X likes use the same DOM click type as Following and randomize pre-click waits', () => {
  assert.match(xRuntime, /\^\(\?:Following\|フォロー中\)\$/);
  assert.match(xRuntime, /tab\.click\(\)/);
  assert.match(xRuntime, /button\.click\(\)/);
  assert.match(xRuntime, /const likeWaitChoicesMs = \[5 \* 1000, 10 \* 1000, 15 \* 1000\]/);
  assert.match(xRuntime, /Math\.floor\(Math\.random\(\) \* likeWaitChoicesMs\.length\)/);
  assert.match(xRuntime, /state\.result = 'waiting-before-like'/);
  assert.match(xRuntime, /await sleep\(waitMs\)/);
  assert.match(xRuntime, /querySelector\('\[data-testid="unlike"\]'\)/);
  assert.match(xRuntime, /const maxLikeAttemptsPerPost = 3/);
  assert.match(xRuntime, /failedAttempts\.set\(candidate\.id, failures\)/);
});

test('X scrolling is twice the previous targeted speed', () => {
  assert.match(xRuntime, /const maxScrollStepPx = 56/);
  assert.match(xRuntime, /const minScrollStepPx = 20/);
  assert.match(xRuntime, /Math\.ceil\(Math\.abs\(distance\) \* 0\.70\)/);
  assert.match(xRuntime, /state\.result = 'approaching-like'/);
  assert.match(xRuntime, /window\.scrollBy\(\{ top: Math\.sign\(distance\) \* step, behavior: 'smooth' \}\)/);
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
