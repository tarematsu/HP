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

test('YouTube stays 60 minutes while the TVer hour hands its last 5 minutes to X', () => {
  assert.match(mediaBase, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaTverPhaseMs = kNativeMediaPhaseMs/);
  assert.match(mediaBase, /kNativeMediaXPhaseMs = 5U \* 60U \* 1000U/);
  assert.match(mediaBase, /login wait does not pause it/);
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

test('X uses Following and likes a random 5 to 10 latest unliked posts', () => {
  assert.match(xRuntime, /\^\(\?:Following\|フォロー中\)\$/);
  assert.match(xRuntime, /5 \+ Math\.floor\(Math\.random\(\) \* 6\)/);
  assert.match(xRuntime, /article\[data-testid="tweet"\]/);
  assert.match(xRuntime, /\[data-testid="like"\]/);
  assert.match(xRuntime, /button\.click\(\)/);
  assert.match(xRuntime, /Promoted\|プロモーション\|広告/);
  assert.doesNotMatch(xRuntime, /data-testid="unlike"|data-testid="retweet"|data-testid="follow"/);
});
