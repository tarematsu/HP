import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const clean = read('../../native/src/renderer_panels/media_youtube_policy.inc');
const trustedAction = read('../../native/src/renderer_panels/media_youtube_trusted_action.inc');
const recovery = read('../../native/src/renderer_panels/media_youtube_control_recovery.inc');
const eventAgent = read('../../native/src/renderer_panels/media_youtube_event_agent.inc');
const reliablePlayAll = read('../../native/src/renderer_panels/media_youtube_playall_reliable.inc');
const composition = read('../../native/src/renderer_panels/media_section.inc');
const mediaBase = read('../../native/src/renderer_panels/media_section_base.inc');
const trustedInput = read('../../native/src/renderer_panels/media_trusted_input.inc');

test('YouTube startup normally lands on cloud-resolved watch item', () => {
  assert.match(mediaBase, /homepanel-cloud\.tarematsu\.workers\.dev\/v1\/native\/youtube-start/);
  assert.match(reliablePlayAll, /ytd-playlist-video-renderer a#thumbnail/);
  assert.match(reliablePlayAll, /url\.searchParams\.set\('list', list\)/);
  assert.match(reliablePlayAll, /referrerPolicy = 'no-referrer'/);
  assert.match(reliablePlayAll, /rel = 'noreferrer'/);
  assert.match(composition, /kNativeMediaYoutubeReliablePlayAllScript/);
});

test('paused playback recovers through direct play then trusted Play', () => {
  assert.match(recovery, /video\?\.paused && !video\.ended/);
  assert.match(recovery, /video\.play\(\)\?\.catch/);
  assert.match(recovery, /player\.querySelector\('\.ytp-play-button'\)/);
  assert.match(recovery, /trusted\.arm\(play, 'play', 1500\)/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
});

test('YouTube surveys stay inside active ad handling', () => {
  const adStart = recovery.indexOf('if (trusted.ad()) {');
  const survey = recovery.indexOf('const roots = player.querySelectorAll', adStart);
  const content = recovery.indexOf('const state = window.__homePanelYoutubeRecoveryState');
  assert.ok(adStart >= 0 && survey > adStart && content > survey);
  assert.match(recovery, /trusted\.arm\(option, 'survey-option', 500\)/);
  assert.match(recovery, /trusted\.arm\(submit, 'survey-submit', 500\)/);
});

test('ad skip and fullscreen still use verified real controls', () => {
  assert.match(recovery, /trusted\.arm\(target, 'skip-ad', 600\)/);
  assert.match(recovery, /const fullscreenSettleMs = 1500/);
  assert.match(recovery, /armFullscreen/);
  assert.match(trustedAction, /action === 'fullscreen'/);
  assert.match(trustedAction, /return \[5000, 5000\]/);
  assert.doesNotMatch(trustedAction, /requestFullscreen|webkitRequestFullscreen/);
});

test('content settings remain one-shot per video at 360p with captions off', () => {
  assert.match(recovery, /videoKey/);
  assert.match(recovery, /qualityApplied: false/);
  assert.match(recovery, /captionsApplied: false/);
  assert.match(recovery, /const preferredQuality = 'medium'/);
  assert.match(recovery, /setPlaybackQualityRange\(preferredQuality, preferredQuality\)/);
  assert.match(recovery, /setPlaybackQuality\(preferredQuality\)/);
  assert.match(recovery, /player\.setOption\('captions', 'track', \{\}\)/);
});

test('event agent owns notification only, not recovery policy', () => {
  assert.match(eventAgent, /homepanel:youtube-wake/);
  assert.match(eventAgent, /scheduleRecoveryWake/);
  assert.match(eventAgent, /attributeFilter: \['class'\]/);
  assert.doesNotMatch(eventAgent, /setPlaybackQuality|nextVideo|ytp-ad-skip/);
  assert.match(composition, /#include "media_youtube_event_agent\.inc"/);
});

test('clean player keeps useful skip UI while hiding chrome', () => {
  assert.match(clean, /#movie_player \.ytp-ad-skip-button-modern/);
  assert.match(clean, /#movie_player \.ytp-share-button/);
  assert.match(clean, /ytd-unified-share-panel-renderer/);
});
