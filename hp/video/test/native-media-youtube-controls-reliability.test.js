import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const wrapper = read('../../native/src/renderer_panels/media_section.inc');
const base = read('../../native/src/renderer_panels/media_section_base.inc');
const host = read('../../native/src/renderer_panels/media_host.inc');
const trustedInput = read('../../native/src/renderer_panels/media_trusted_input.inc');
const runtime = read('../../native/src/renderer_panels/media_youtube_control_recovery.inc');

test('YouTube steady watchdog stays low frequency and event assisted', () => {
  assert.match(base, /kNativeMediaYoutubeWatchdogHealthyMs = 30U \* 1000U/);
  assert.match(base, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(host, /ProbeYoutubeWatchdog/);
  assert.match(runtime, /homepanel:youtube-wake/);
  assert.match(wrapper, /add_WebMessageReceived/);
});

test('YouTube watchdog still self-heals lost callbacks', () => {
  assert.match(host, /kYoutubeWatchdogTimeoutMs = 5ULL \* 1000ULL/);
  assert.match(host, /youtubeWatchdogRequestGeneration_/);
  assert.match(host, /youtubeWatchdogStartedTick_/);
  assert.match(host, /InvalidateYoutubeWatchdog\(\)/);
});

test('trusted media clicks are foreground independent WebView dispatches', () => {
  assert.match(trustedInput, /ICoreWebView2Controller3/);
  assert.match(trustedInput, /get_RasterizationScale/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(trustedInput, /\bSendInput\s*\(/);
  assert.doesNotMatch(trustedInput, /SetForegroundWindow|GetForegroundWindow/);
});

test('ad skip stays player-local and variant tolerant', () => {
  assert.match(runtime, /\.ytp-ad-skip-button-modern/);
  assert.match(runtime, /\.ytp-skip-ad-button/);
  assert.match(runtime, /aria-label\*=\"Skip ad\" i/);
  assert.match(runtime, /aria-label\*=\"広告をスキップ\"/);
  assert.match(runtime, /player\.querySelectorAll\(skipSelector\)/);
  assert.doesNotMatch(runtime, /document\.querySelectorAll\([^)]*skip/);
});

test('message dialogs close through the same trusted CDP action path', () => {
  assert.match(runtime, /document\.querySelector\('ytd-popup-container'\)/);
  assert.match(runtime, /\^\(閉じる\|close\)\$/);
  assert.match(runtime, /root\.matches\(surveySelector\)/);
  assert.match(runtime, /root\.querySelector\(surveySelector\)/);
  assert.match(runtime, /return arm\(close, 'dialog-close', 500\)/);
  assert.doesNotMatch(runtime, /\.click\(\)/);
});

test('continue-watching dialogs confirm yes through trusted input', () => {
  assert.match(runtime, /視聴を続けていますか/);
  assert.match(runtime, /動画がまもなく一時停止されます/);
  assert.match(runtime, /\^\(はい\|yes\|続ける\|視聴を続ける\|continue\|continue watching\)\$/i);
  assert.match(runtime, /return arm\(keepWatching, 'dialog-continue-watching', 1000\)/);
  assert.doesNotMatch(runtime, /keepWatching\.click\(\)/);
});

test('captions off uses trusted input when the UI toggle is active', () => {
  assert.match(runtime, /aria-pressed'\) === 'true'/);
  assert.match(runtime, /return arm\(captions, 'captions-off', 800\) \|\| 'recovery'/);
  assert.doesNotMatch(runtime, /captions\.click\(\)/);
});

test('trusted controls revalidate their CSS point when input actually arrives', () => {
  assert.match(runtime, /const guardedEventTypes = \['pointerdown', 'mousedown', 'mouseup', 'click'\]/);
  assert.match(runtime, /const guardClick = event =>/);
  assert.match(runtime, /hitOwnControl\(point\)/);
  assert.match(runtime, /document\.addEventListener\(type, guardClick, true\)/);
  assert.match(runtime, /document\.removeEventListener\(type, guardClick, true\)/);
  assert.match(runtime, /const accepted = valid\(element\) && hitOwnControl\(point\)/);
});

test('paused playback tries direct play before any toggle click', () => {
  const paused = runtime.indexOf('if (video?.paused && !video.ended)');
  const directPlay = runtime.indexOf('video.play()?.catch', paused);
  const grace = runtime.indexOf('directPlayAge < 1200', directPlay);
  const toggle = runtime.indexOf("arm(player.querySelector('.ytp-play-button'), 'play', 1500)", grace);
  assert.ok(paused >= 0 && directPlay > paused);
  assert.ok(grace > directPlay && toggle > grace);
  assert.match(runtime, /directPlayRequestedAt: 0/);
  assert.match(runtime, /state\.directPlayRequestedAt = now/);
  assert.match(runtime, /wake\(1200\)/);
});

test('paused and stalled content share one recovery path', () => {
  assert.match(runtime, /video\?\.paused && !video\.ended/);
  assert.match(runtime, /state\.pausedSince >= 10 \* 1000/);
  assert.match(runtime, /state\.lastProgressAt >= 30 \* 1000/);
  assert.match(runtime, /player\.querySelector\('\.ytp-next-button\[href\]'\)/);
  assert.match(runtime, /typeof player\.nextVideo === 'function'/);
});
