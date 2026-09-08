import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tverStatic = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
  'utf8',
);
const playbackPolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url),
  'utf8',
);

const loopStart = tverStatic.indexOf('kNativeMediaTverLoopStaticScript');
const watchdogStart = tverStatic.indexOf('kNativeMediaTverWatchdogStaticScript');
assert.ok(loopStart >= 0 && watchdogStart > loopStart);
const loopScript = tverStatic.slice(loopStart, watchdogStart);

test('TVer four-second loop never owns playback recovery', () => {
  assert.doesNotMatch(loopScript, /const playButton/);
  assert.doesNotMatch(loopScript, /video\.play\s*\(/);
  assert.doesNotMatch(loopScript, /playButton\.click\s*\(/);
  assert.match(loopScript, /Playback recovery has exactly one owner/);
});

test('paused TVer playback is recovered only by the trusted-input watchdog', () => {
  assert.match(
    playbackPolicy,
    /if \(!video \|\| \(video\.paused && !video\.ended\)\)/,
  );
  assert.match(playbackPolicy, /if \(playButton\) return point\(playButton\)/);
  assert.match(playbackPolicy, /if \(video\) return point\(video\)/);
});
