import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);
const reliablePlayAll = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_playall_reliable.inc', import.meta.url),
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

test('YouTube playlist startup bypasses fragile Play all coordinates', () => {
  assert.match(reliablePlayAll, /ytd-playlist-video-renderer a#thumbnail/);
  assert.match(reliablePlayAll, /url\.searchParams\.set\('list', playlistId\)/);
  assert.match(reliablePlayAll, /location\.assign\(href\)/);
  assert.match(reliablePlayAll, /すべて再生/);
  assert.match(reliablePlayAll, /全て再生/);
  assert.match(reliablePlayAll, /play all/i);
  assert.match(reliablePlayAll, /playAll\.click\(\)/);
  assert.match(reliablePlayAll, /return null/);
  assert.match(
    composition,
    /script == kNativeMediaPlayAllScript[\s\S]*kNativeMediaYoutubeReliablePlayAllScript/,
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
  assert.match(policy, /広告をスキップ\|広告を飛ばす\|skip\\s\+ad/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(trustedInput, /::SendInput/);
});

test('YouTube clean player exposes Skip Ad without restoring unrelated ad chrome', () => {
  assert.doesNotMatch(policy, /#movie_player\.ad-showing \*/);
  assert.doesNotMatch(policy, /#movie_player\.ad-interrupting \*/);
  assert.match(policy, /#movie_player \.ytp-ad-skip-button-modern/);
  assert.match(policy, /#movie_player \.ytp-share-button/);
  assert.match(policy, /#movie_player \.ytp-tooltip/);
  assert.match(policy, /ytd-unified-share-panel-renderer/);
  assert.match(
    policy,
    /tp-yt-paper-dialog:has\(ytd-unified-share-panel-renderer\)/,
  );
});

test('YouTube playback quality is pinned to the 480p quality level', () => {
  assert.match(policy, /const preferredQuality = 'large'/);
  assert.match(
    policy,
    /setPlaybackQualityRange\(preferredQuality, preferredQuality\)/,
  );
  assert.match(policy, /setPlaybackQuality\(preferredQuality\)/);
  assert.doesNotMatch(policy, /hd720/);
});

test('media host substitutes legacy YouTube scripts with the current policy', () => {
  assert.match(composition, /#include "media_youtube_policy\.inc"/);
  assert.match(composition, /#include "media_youtube_playall_reliable\.inc"/);
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
