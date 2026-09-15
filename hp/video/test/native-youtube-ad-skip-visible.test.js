import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const clean = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url), 'utf8');
const recovery = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);

test('YouTube clean-player exposes Skip Ad without restoring normal chrome', () => {
  assert.equal(clean.includes('#movie_player > :not(.html5-video-container),'), false);
  assert.ok(clean.includes(
    '#movie_player:not(.ad-showing):not(.ad-interrupting) > :not(.html5-video-container),',
  ));
  assert.equal(clean.includes('#movie_player.ad-showing *,'), false);
  assert.ok(clean.includes('#movie_player .ytp-ad-skip-button-modern,'));
  assert.ok(clean.includes('#movie_player [class*="ytp-ad-skip"],'));
  assert.ok(clean.includes('#movie_player [aria-label*="広告をスキップ"]'));
  assert.ok(clean.includes('#movie_player .ytp-share-button,'));
  assert.match(clean, /opacity:\s*1 !important/);
  assert.match(clean, /pointer-events:\s*auto !important/);
});

test('YouTube recovery accepts current skip layouts inside the player', () => {
  assert.ok(recovery.includes('.ytp-ad-skip-button-modern'));
  assert.ok(recovery.includes('.ytp-skip-ad-button'));
  assert.ok(recovery.includes('[class*="ytp-ad-skip"]'));
  assert.ok(recovery.includes('[aria-label*="Skip ad" i]'));
  assert.ok(recovery.includes('[aria-label*="広告を飛ばす"]'));
  assert.ok(recovery.includes("return trusted.arm(target, 'skip-ad', 600)"));
  assert.doesNotMatch(recovery, /document\.querySelectorAll\([^)]*skip/);
});