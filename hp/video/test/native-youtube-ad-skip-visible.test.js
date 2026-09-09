import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);

const cleanStart = policy.indexOf('kNativeMediaYoutubeCleanPlayerScript');
const watchdogStart = policy.indexOf('kNativeMediaYoutubeWatchdogPolicyScript');
const healthStart = policy.indexOf('kNativeMediaYoutubeHealthPolicyScript');
assert.ok(cleanStart >= 0 && watchdogStart > cleanStart && healthStart > watchdogStart);

const clean = policy.slice(cleanStart, watchdogStart);
const watchdog = policy.slice(watchdogStart, healthStart);

test('YouTube clean-player exposes only ad skip UI without restoring normal playback chrome', () => {
  assert.equal(clean.includes('#movie_player > :not(.html5-video-container),'), false);
  assert.ok(clean.includes(
    '#movie_player:not(.ad-showing):not(.ad-interrupting) > :not(.html5-video-container),',
  ));
  assert.equal(clean.includes('#movie_player.ad-showing *,'), false);
  assert.equal(clean.includes('#movie_player.ad-interrupting * {'), false);
  assert.ok(clean.includes('#movie_player .ytp-ad-skip-button-container,'));
  assert.ok(clean.includes('#movie_player [aria-label*="広告をスキップ"]'));
  assert.ok(clean.includes('#movie_player .ytp-share-button,'));
  assert.ok(clean.includes('#movie_player .ytp-tooltip,'));
  assert.ok(clean.includes('ytd-unified-share-panel-renderer,'));
  assert.ok(clean.includes('opacity: 1 !important;'));
  assert.ok(clean.includes('visibility: visible !important;'));
  assert.ok(clean.includes('pointer-events: auto !important;'));
});

test('YouTube watchdog accepts current and legacy skip layouts', () => {
  assert.ok(watchdog.includes('.ytp-ad-skip-button-slot [role="button"]'));
  assert.ok(watchdog.includes('.ytp-ad-skip-button-container [role="button"]'));
  assert.ok(watchdog.includes('[class*="ytp-ad-skip"][role="button"]'));
  assert.ok(watchdog.includes('button[aria-label*="スキップ"]'));
  assert.ok(watchdog.includes('[aria-label*="Skip ad" i]'));
  assert.ok(watchdog.includes('[aria-label*="広告を飛ばす"]'));
  assert.ok(watchdog.includes("guardedPoint(target, 'skip-ad', 750, true)"));
});
