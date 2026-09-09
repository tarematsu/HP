import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);
const recovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url),
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

test('YouTube watchdog recovers a paused watch page without depending on visible chrome', () => {
  assert.match(recovery, /video && video\.paused && !video\.ended/);
  assert.match(recovery, /video\.play\(\)/);
  assert.match(recovery, /player\.querySelector\('\.ytp-play-button'\)/);
  assert.match(recovery, /prepareTrustedTarget/);
  assert.match(recovery, /pointer-events', 'auto', 'important'/);
  assert.match(recovery, /armTrustedAction\(playButton, 'play', 1500\)/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
});

test('YouTube surveys choose the first available option then submit', () => {
  assert.match(recovery, /surveyRoots/);
  assert.match(recovery, /state\.step === 0[\s\S]*guardedPoint\(options\[0\], 'survey-option'/);
  assert.match(recovery, /state\.step = 0;\s*return guardedPoint\(submit, 'survey-submit'/);
  assert.match(recovery, /送信\|回答を送信\|submit\|send/);
});

test('YouTube ad skip uses a stable trusted landing target and never falls through to playback controls', () => {
  assert.match(recovery, /\.ytp-ad-skip-button-modern/);
  assert.match(recovery, /button\[class\*="ytp-ad-skip"\]/);
  assert.match(recovery, /広告をスキップ\|広告を飛ばす/);
  assert.match(recovery, /skip\\s\*ad/);
  assert.match(recovery, /adShowing && target\) return armTrustedAction\(target, 'skip-ad', 600\)/);
  assert.match(recovery, /if \(adShowing\) return null/);
  assert.doesNotMatch(recovery, /\[class\*="skip" i\]\)\)/);
  assert.match(recovery, /__homePanelYoutubeTrustedActionTarget/);
  assert.match(recovery, /event\.stopImmediatePropagation\(\)/);
  assert.match(recovery, /return \[5000, 5000\]/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(trustedInput, /::SendInput/);
});

test('YouTube fullscreen recovery keeps the trusted click off the moving video surface', () => {
  assert.match(recovery, /player\.querySelector\('\.ytp-fullscreen-button'\)/);
  assert.match(recovery, /全画面\|fullscreen\|full screen/i);
  assert.match(recovery, /return armTrustedAction\(target, 'fullscreen', 1200\)/);
  assert.match(recovery, /document\.fullscreenElement/);
  assert.match(recovery, /position:fixed/);
  assert.match(recovery, /inset:0/);
  assert.match(recovery, /target\.click\(\)/);
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

test('media host routes watchdog to the trusted control recovery policy', () => {
  assert.match(composition, /#include "media_youtube_policy\.inc"/);
  assert.match(composition, /#include "media_youtube_control_recovery\.inc"/);
  assert.match(composition, /#include "media_youtube_playall_reliable\.inc"/);
  assert.match(composition, /ResolveNativeMediaPolicyScript/);
  assert.match(
    composition,
    /script == kNativeMediaYoutubeWatchdogScript[\s\S]*kNativeMediaYoutubeControlRecoveryScript/,
  );
  assert.match(
    composition,
    /script == kNativeMediaYoutubeHealthScript[\s\S]*kNativeMediaYoutubeHealthPolicyScript/,
  );
});
