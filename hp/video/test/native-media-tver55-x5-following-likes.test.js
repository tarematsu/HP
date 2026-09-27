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
const documentStart = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url);

test('YouTube stays 60 minutes while the TVer hour hands its last 5 minutes to X', () => {
  assert.match(mediaBase, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
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

test('X uses Following and likes a random 5 to 10 latest unliked posts', () => {
  assert.match(documentStart, /\^\(\?:Following\|フォロー中\)\$/);
  assert.match(documentStart, /5 \+ Math\.floor\(Math\.random\(\) \* 6\)/);
  assert.match(documentStart, /article\[data-testid="tweet"\]/);
  assert.match(documentStart, /\[data-testid="like"\]/);
  assert.match(documentStart, /button\.click\(\)/);
  assert.match(documentStart, /Promoted\|プロモーション\|広告/);
  assert.doesNotMatch(documentStart, /data-testid="unlike"|data-testid="retweet"|data-testid="follow"/);
});
