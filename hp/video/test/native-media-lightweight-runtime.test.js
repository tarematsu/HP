import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url), 'utf8');
const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const mediaWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url), 'utf8');
const radarSection = readFileSync(
  new URL('../../native/src/renderer_panels/radar_section.inc', import.meta.url), 'utf8');
const mediaWrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const tverEpisode = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url), 'utf8');
const youtubeRecovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url), 'utf8');
const youtubeAgent = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_event_agent.inc', import.meta.url), 'utf8');
const mediaPanel = [mediaBase, mediaHost, mediaWindow].join('\n');

test('TVer uses media events plus a player-local observer, never a document-wide loop', () => {
  assert.match(tverEpisode, /const bindPlayerObserver = video =>/);
  assert.match(tverEpisode, /playerObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(tverEpisode, /observer\.observe\(document\.(?:documentElement|body)/);
  assert.doesNotMatch(tverEpisode, /setInterval\(ensure/);
  assert.match(tverEpisode, /addEventListener\('timeupdate'/);
  assert.match(tverEpisode, /event\.target instanceof HTMLMediaElement/);
  assert.match(tverEpisode, /homepanel:tver-wake/);
});

test('YouTube uses event wakeups with a 30-second steady watchdog backstop', () => {
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogHealthyMs = 30U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(youtubeAgent, /homepanel:youtube-wake/);
  assert.match(youtubeAgent, /state\.playerObserver\.observe\(player, \{ childList: true, subtree: true \}\)/);
  assert.match(youtubeAgent, /attributeFilter: \['class'\]/);
  assert.match(mediaWrapper, /add_WebMessageReceived/);
  assert.match(mediaWrapper, /kNativeMediaYoutubeWatchdogTimer/);
  assert.match(youtubeRecovery, /video && video\.error/);
  assert.match(youtubeRecovery, /player\.classList\.contains\('ytp-error'\)/);
  assert.doesNotMatch(mediaPanel, /kNativeMediaPlaybackHealthTimer|ProbeYoutubeHealth/);
});

test('YouTube applies 480p per video instead of on every healthy watchdog pass', () => {
  assert.match(youtubeRecovery, /videoKey/);
  assert.match(youtubeRecovery, /qualityApplied: false/);
  assert.match(youtubeRecovery, /if \(!recoveryState\.qualityApplied\)/);
  assert.match(youtubeRecovery, /setPlaybackQualityRange\(preferredQuality, preferredQuality\)/);
  assert.match(youtubeRecovery, /setPlaybackQuality\(preferredQuality\)/);
  assert.doesNotMatch(mediaBase, /setPlaybackQualityRange\('large', 'large'\)/);
});

test('playlist startup still has one bounded native fallback', () => {
  assert.match(mediaBase, /kNativeMediaPlayAllRetryMs = 500U/);
  assert.match(mediaBase, /kNativeMediaPlayAllRetryLimit = 20/);
  assert.match(
    mediaHost,
    /playAllProbeAttempts_ >= kNativeMediaPlayAllRetryLimit[\s\S]*ClickNormalizedPoint\(kNativeMediaFallbackPlayAllXTenThousandths/,
  );
});

test('media responsibilities remain separate from radar rendering', () => {
  assert.match(mediaBase, /#include "media_host\.inc"/);
  assert.match(mediaBase, /#include "media_host_window\.inc"/);
  assert.doesNotMatch(mediaBase, /radar_section\.inc/);
  assert.match(composition, /#include "renderer_panels\/radar_section\.inc"/);
  assert.match(mediaHost, /class NativeMediaPanelHost final/);
  assert.match(mediaWindow, /LRESULT CALLBACK NativeMediaPanelWndProc/);
  assert.match(radarSection, /void Renderer::DrawRadarSection/);
  assert.doesNotMatch(composition, /kNativeMediaYoutubeWatchdogOverrideScript/);
});
