import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);

const watchdogStart = policy.indexOf('kNativeMediaYoutubeWatchdogPolicyScript');
const healthStart = policy.indexOf('kNativeMediaYoutubeHealthPolicyScript');
assert.ok(watchdogStart >= 0 && healthStart > watchdogStart);
const watchdog = policy.slice(watchdogStart, healthStart);
const health = policy.slice(healthStart);

test('YouTube ads only allow survey and skip actions before the ad guard', () => {
  const skip = watchdog.indexOf("guardedPoint(target, 'skip-ad', 750, true)");
  const adGuard = watchdog.indexOf('if (adShowing) return null;');
  const captions = watchdog.indexOf("player.querySelector('.ytp-subtitles-button')");
  const playRecovery = watchdog.indexOf('video.paused && !video.ended');
  const fullscreen = watchdog.indexOf("player.querySelector('.ytp-fullscreen-button')");

  assert.ok(skip >= 0 && skip < adGuard);
  assert.ok(adGuard >= 0 && adGuard < captions);
  assert.ok(adGuard < playRecovery);
  assert.ok(adGuard < fullscreen);
});

test('hidden YouTube ad skip controls remain eligible for trusted clicks', () => {
  assert.match(watchdog, /\.find\(element => isClickable\(element, true\)\) \|\| null/);
  assert.match(
    watchdog,
    /\.find\(element => isClickable\(element, true\) &&[\s\S]*skipPattern\.test\(textOf\(element\)\)\)/,
  );
  assert.match(watchdog, /guardedPoint\(target, 'skip-ad', 750, true\)/);
});

test('YouTube health does not force 480p while an ad is active', () => {
  const adState = health.indexOf("player.classList.contains('ad-showing')");
  const contentOnly = health.indexOf('if (player && !adShowing)');
  const preferred = health.indexOf("const preferredQuality = 'large'");
  const qualityRange = health.indexOf(
    'setPlaybackQualityRange(preferredQuality, preferredQuality)',
  );
  const quality = health.indexOf('setPlaybackQuality(preferredQuality)');

  assert.ok(adState >= 0 && adState < contentOnly);
  assert.ok(contentOnly >= 0 && contentOnly < preferred);
  assert.ok(preferred < qualityRange);
  assert.ok(preferred < quality);
});
