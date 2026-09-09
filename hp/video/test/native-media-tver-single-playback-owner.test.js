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

test('paused TVer playback is recovered only by the episode watchdog', () => {
  assert.match(playbackPolicy, /if \(video\.paused && !video\.ended\)/);
  assert.match(playbackPolicy, /const pending = video\.play\(\)/);
  assert.match(playbackPolicy, /video\.__homePanelTverResumeBlocked/);
  assert.match(playbackPolicy, /return playButton \? point\(playButton\) : null/);
  assert.doesNotMatch(playbackPolicy, /return point\(video\)/);
  assert.doesNotMatch(playbackPolicy, /video\.pause\s*\(/);
});
