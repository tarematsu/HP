import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url),
  'utf8',
);

test('YouTube playlist startup accepts Play all variants and first-item fallback', () => {
  assert.match(policy, /すべて再生/);
  assert.match(policy, /全て再生/);
  assert.match(policy, /play all/i);
  assert.match(policy, /ytd-playlist-video-renderer a#thumbnail/);
  assert.match(
    composition,
    /script == kNativeMediaPlayAllScript[\s\S]*kNativeMediaYoutubePlayAllPolicyScript/,
  );
});

test('YouTube watchdog recovers a paused watch page with a trusted play click', () => {
  assert.match(policy, /video && video\.paused && !video\.ended/);
  assert.match(policy, /player\.querySelector\('\.ytp-play-button'\)/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
});

test('five-choice YouTube surveys choose the first option then submit', () => {
  assert.match(policy, /surveyRoots/);
  assert.match(policy, /options\.length < 5/);
  assert.match(policy, /state\.step === 0[\s\S]*return point\(options\[0\]\)/);
  assert.match(policy, /state\.step = 0;\s*return point\(submit\)/);
  assert.match(policy, /送信\|回答を送信\|submit\|send/);
});

test('YouTube ad skip recognizes both selectors and visible skip labels', () => {
  assert.match(policy, /\.ytp-ad-skip-button-modern/);
  assert.match(policy, /button\[class\*="ytp-ad-skip"\]/);
  assert.match(policy, /広告をスキップ\|広告を飛ばす\|skip ad\|skip ads/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(trustedInput, /::SendInput/);
});

test('YouTube playback quality is pinned to the 720p quality level', () => {
  assert.match(policy, /setPlaybackQualityRange\('hd720', 'hd720'\)/);
  assert.match(policy, /setPlaybackQuality\('hd720'\)/);
  assert.doesNotMatch(policy, /setPlaybackQuality\('large'\)/);
});

test('media host substitutes legacy YouTube scripts with the current policy', () => {
  assert.match(composition, /#include "media_youtube_policy\.inc"/);
  assert.match(composition, /ResolveNativeMediaPolicyScript/);
  assert.match(
    composition,
    /script == kNativeMediaYoutubeWatchdogScript[\s\S]*kNativeMediaYoutubeWatchdogPolicyScript/,
  );
  assert.match(
    composition,
    /script == kNativeMediaYoutubeHealthScript[\s\S]*kNativeMediaYoutubeHealthPolicyScript/,
  );
});
