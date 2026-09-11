import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const clean = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url), 'utf8');
const recovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url), 'utf8');

test('YouTube clean-player exposes Skip Ad without restoring normal chrome', () => {
  assert.equal(clean.includes('#movie_player > :not(.html5-video-container),'), false);
  assert.ok(clean.includes(
    '#movie_player:not(.ad-showing):not(.ad-interrupting) > :not(.html5-video-container),',
  ));
  assert.equal(clean.includes('#movie_player.ad-showing *,'), false);
  assert.ok(clean.includes('#movie_player .ytp-ad-skip-button-container,'));
  assert.ok(clean.includes('#movie_player [aria-label*="広告をスキップ"]'));
  assert.ok(clean.includes('#movie_player .ytp-share-button,'));
  assert.ok(clean.includes('opacity: 1 !important;'));
  assert.ok(clean.includes('pointer-events: auto !important;'));
});

test('YouTube recovery accepts current and legacy skip layouts inside the player', () => {
  assert.ok(recovery.includes('.ytp-ad-skip-button-slot [role="button"]'));
  assert.ok(recovery.includes('.ytp-ad-skip-button-container [role="button"]'));
  assert.ok(recovery.includes('[class*="ytp-ad-skip"][role="button"]'));
  assert.ok(recovery.includes('[aria-label*="Skip ad" i]'));
  assert.ok(recovery.includes('[aria-label*="広告を飛ばす"]'));
  assert.ok(recovery.includes("return trusted.arm(target, 'skip-ad', 600)"));
  assert.doesNotMatch(recovery, /document\.querySelectorAll\([^)]*skip/);
});
