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
const xRuntime = readFileSync(
  new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url), 'utf8');

test('startup shows X for 5 minutes before a full 60-minute YouTube phase', () => {
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs = 5U \* 60U \* 1000U/);
  assert.match(mediaBase, /https:\/\/x\.com\/home\?homepanel=startup/);
  assert.match(mediaBase, /return kNativeMediaStartupXPhaseMs \+ kNativeMediaYoutubePhaseMs/);
  assert.match(mediaBase, /deadline > now[\s\S]*return kNativeMediaStartupXUrl/);
  assert.match(xRuntime, /homepanel:startup-x-until:v1/);
  assert.match(xRuntime, /Date\.now\(\) \+ 5 \* 60 \* 1000/);
  assert.match(xRuntime, /location\.assign\(youtubeStart\)/);
});

test('YouTube stays 60 minutes while the TVer hour hands its last 5 minutes to X', () => {
  assert.match(mediaBase, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaTverPhaseMs = kNativeMediaPhaseMs/);
  assert.match(tverQueue, /kNativeMediaTverContentPhaseMs = 55ULL \* 60ULL \* 1000ULL/);
  assert.match(tverQueue, /ULONGLONG phaseStartedAt = 0/);
  assert.match(tverQueue, /NativeMediaTverXPhaseActive\(\)/);
  assert.match(tverRuntime, /const phaseMs = 55 \* 60 \* 1000/);
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
  assert.doesNotMatch(xRuntime, /homepanel:x-waiting-login|homepanel:x-authenticated/);
  const waitStart = xRuntime.indexOf('let tab = followingTab()');
  const authEnd = xRuntime.indexOf("state.result = 'authenticated'", waitStart);
  const waiting = xRuntime.slice(waitStart, authEnd);
  assert.doesNotMatch(waiting, /\.click\(|scrollTo\(|scrollBy\(/);
});

test('X slowly scrolls before each of 2 to 5 likes', () => {
  assert.match(xRuntime, /\^\(\?:Following\|フォロー中\)\$/);
  assert.match(xRuntime, /2 \+ Math\.floor\(Math\.random\(\) \* 4\)/);
  assert.match(xRuntime, /window\.scrollBy\(\{ top: scrollDistance, behavior: 'smooth' \}\)/);
  assert.match(xRuntime, /await sleep\(1800 \+ Math\.floor\(Math\.random\(\) \* 1400\)\)/);
  assert.match(xRuntime, /await sleep\(1400 \+ Math\.floor\(Math\.random\(\) \* 1600\)\)/);
  assert.match(xRuntime, /article\[data-testid="tweet"\]/);
  assert.match(xRuntime, /\[data-testid="like"\]/);
  assert.match(xRuntime, /button\.click\(\)/);
  assert.match(xRuntime, /Promoted\|プロモーション\|広告/);
  assert.doesNotMatch(xRuntime, /data-testid="unlike"|data-testid="retweet"|data-testid="follow"/);

  const loopStart = xRuntime.indexOf('for (let pass = 0; pass < 24');
  const scrollAt = xRuntime.indexOf("behavior: 'smooth'", loopStart);
  const likeAt = xRuntime.indexOf('button.click()', loopStart);
  const breakAt = xRuntime.indexOf('break;', likeAt);
  assert.ok(loopStart >= 0 && scrollAt > loopStart && likeAt > scrollAt && breakAt > likeAt);
});
