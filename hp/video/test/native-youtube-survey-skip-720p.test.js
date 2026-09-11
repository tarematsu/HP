import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const clean = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url), 'utf8');
const trustedAction = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_trusted_action.inc', import.meta.url), 'utf8');
const recovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url), 'utf8');
const eventAgent = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_event_agent.inc', import.meta.url), 'utf8');
const reliablePlayAll = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_playall_reliable.inc', import.meta.url), 'utf8');
const composition = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url), 'utf8');

test('YouTube playlist startup bypasses fragile fixed Play all coordinates', () => {
  assert.match(reliablePlayAll, /ytd-playlist-video-renderer a#thumbnail/);
  assert.match(reliablePlayAll, /url\.searchParams\.set\('list', playlistId\)/);
  assert.match(reliablePlayAll, /location\.assign\(href\)/);
  assert.match(reliablePlayAll, /すべて再生/);
  assert.match(reliablePlayAll, /play all/i);
  assert.match(composition, /kNativeMediaYoutubeReliablePlayAllScript/);
});

test('YouTube paused playback recovers through trusted action', () => {
  assert.match(recovery, /video && video\.paused && !video\.ended/);
  assert.match(recovery, /video\.play\(\)/);
  assert.match(recovery, /player\.querySelector\('\.ytp-play-button'\)/);
  assert.match(recovery, /trusted\.arm\(play, 'play', 1500\)/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
});

test('YouTube surveys are inspected only inside an active ad player', () => {
  const adStart = recovery.indexOf('if (adShowing) {');
  const surveys = recovery.indexOf('const surveyRoots =', adStart);
  const content = recovery.indexOf('const recoveryState =');
  assert.ok(adStart >= 0 && surveys > adStart && content > surveys);
  assert.match(recovery, /player\.querySelectorAll\(/);
  assert.match(recovery, /survey\.step === 0/);
  assert.match(recovery, /trusted\.arm\(options\[0\], 'survey-option', 500\)/);
  assert.match(recovery, /trusted\.arm\(submit, 'survey-submit', 500\)/);
});

test('YouTube ad skip reaches the verified real control', () => {
  assert.match(recovery, /\.ytp-ad-skip-button-modern/);
  assert.match(recovery, /button\[class\*=\"ytp-ad-skip\"\]/);
  assert.match(recovery, /広告をスキップ\|広告を飛ばす/);
  assert.match(recovery, /trusted\.arm\(target, 'skip-ad', 600\)/);
  assert.match(trustedAction, /Move the REAL validated control/);
  assert.match(trustedAction, /return \[5000, 5000\]/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
});

test('YouTube fullscreen uses the real trusted control for ads and content', () => {
  assert.match(recovery, /player\.querySelector\('\.ytp-fullscreen-button'\)/);
  assert.match(recovery, /trusted\.arm\(target, 'fullscreen', 1200\)/);
  assert.match(trustedAction, /action === 'fullscreen'/);
  assert.doesNotMatch(trustedAction, /requestFullscreen|webkitRequestFullscreen/);
});

test('YouTube 480p and captions are per-video dirty-state settings', () => {
  assert.match(recovery, /videoKey/);
  assert.match(recovery, /qualityApplied: false/);
  assert.match(recovery, /captionsApplied: false/);
  assert.match(recovery, /const preferredQuality = 'large'/);
  assert.match(recovery, /setPlaybackQualityRange\(preferredQuality, preferredQuality\)/);
  assert.match(recovery, /setPlaybackQuality\(preferredQuality\)/);
  assert.match(recovery, /player\.setOption\('captions', 'track', \{\}\)/);
});

test('event agent wakes the native watchdog only on relevant player transitions', () => {
  assert.match(eventAgent, /homepanel:youtube-wake/);
  assert.match(eventAgent, /state\.playerObserver\.observe\(player, \{ childList: true, subtree: true \}\)/);
  assert.match(eventAgent, /attributeFilter: \['class'\]/);
  assert.doesNotMatch(eventAgent, /document\.documentElement.*MutationObserver/);
  assert.match(composition, /#include "media_youtube_event_agent\.inc"/);
  assert.match(composition, /kNativeMediaYoutubeEventAgentScript/);
});

test('clean player keeps only useful ad UI visible', () => {
  assert.doesNotMatch(clean, /#movie_player\.ad-showing \*/);
  assert.match(clean, /#movie_player \.ytp-ad-skip-button-modern/);
  assert.match(clean, /#movie_player \.ytp-share-button/);
  assert.match(clean, /ytd-unified-share-panel-renderer/);
});
