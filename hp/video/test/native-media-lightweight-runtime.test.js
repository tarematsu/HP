import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

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
const sharedEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url), 'utf8');
const tverEpisode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const youtubeRuntime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const youtubePlaylistFallback = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_playall_reliable.inc', import.meta.url), 'utf8');
const mediaPanel = [mediaBase, mediaHost, mediaWindow].join('\n');

test('TVer uses one player-local observer plus media events', () => {
  assert.match(tverEpisode, /state\.playerObserver = new MutationObserver\(\(\) => wake\(0\)\)/);
  assert.match(tverEpisode, /state\.playerObserver\.observe\(player/);
  assert.match(tverEpisode, /state\.videoAbort = new AbortController/);
  assert.match(tverEpisode, /'playing','pause','waiting','stalled','ended','error'/);
  assert.match(tverEpisode, /homepanel:tver-wake/);
  assert.doesNotMatch(tverEpisode, /observe\(document\.(?:documentElement|body)/);
  assert.doesNotMatch(tverEpisode, /setInterval\(/);
  assert.doesNotMatch(tverEpisode, /addEventListener\('timeupdate'/);
});

test('TVer completion uses event-time media facts instead of progress polling', () => {
  assert.match(tverEpisode, /event\.type === 'ended'/);
  assert.match(tverEpisode, /const length = duration\(\)/);
  assert.match(tverEpisode, /const at = currentTime\(\)/);
  assert.match(tverEpisode, /key === state\.programKey/);
  assert.match(tverEpisode, /at >= Math\.max\(3, length - 10\)/);
  assert.doesNotMatch(tverEpisode, /progressSteadyIntervalMs|progressNearEndIntervalMs|progressFinalIntervalMs/);
  assert.doesNotMatch(tverEpisode, /progressTimer|timeupdate/);
});

test('TVer healthy playback avoids page-wide ad scanning', () => {
  assert.match(tverEpisode, /const explicitAd = \(\) =>/);
  assert.match(tverEpisode, /player\.querySelectorAll\(selectors\.join\(','\)\)/);
  assert.match(tverEpisode, /const adActive = ad\(\)/);
  assert.doesNotMatch(tverEpisode, /document\.querySelectorAll\(selectors\.join\(','\)\)/);
});

test('TVer event wakeups use one debounced timer with no recovery ticker', () => {
  assert.match(tverEpisode, /const wake = \(delay = 80\) =>/);
  assert.match(tverEpisode, /clearTimeout\(state\.wakeTimer\)/);
  assert.match(tverEpisode, /state\.wakeTimer = setTimeout/);
  assert.match(tverEpisode, /post\('homepanel:tver-wake'\)/);
  assert.doesNotMatch(tverEpisode, /lastWakeSignature|pendingWakeSignature|recoveryWakeTimer|recovery:tick:/);
});

test('YouTube runtime owns event wakeups and the only ad readiness observer', () => {
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogHealthyMs = 30U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(youtubeRuntime, /homepanel:youtube-wake/);
  assert.match(youtubeRuntime, /new AbortController\(\)/);
  assert.match(youtubeRuntime, /attributeFilter: \['class'\]/);
  assert.match(youtubeRuntime, /state\.classObserver\.observe\(player/);
  assert.match(youtubeRuntime, /const syncAdObserver = active =>/);
  assert.match(youtubeRuntime, /state\.adObserver = new MutationObserver/);
  assert.match(youtubeRuntime, /syncAdObserver\(adActive\)/);
  assert.match(youtubeRuntime, /video\?\.error/);
  assert.match(mediaWrapper, /add_WebMessageReceived/);
  assert.doesNotMatch(mediaPanel, /kNativeMediaPlaybackHealthTimer|ProbeYoutubeHealth/);
});

test('media watchdogs use adaptive recovery state and navigation backoff', () => {
  assert.match(mediaHost, /enum class RecoveryState \{ Healthy, Suspect, Recovering, Reloading \}/);
  assert.match(mediaHost, /kNavigationRetryMaxMs = 30U \* 1000U/);
  assert.match(mediaHost, /navigationRetryMs_ = std::min\(kNavigationRetryMaxMs, delayMs \* 2U\)/);
  assert.match(mediaHost, /kTverWatchdogHealthyMs = 60U \* 1000U/);
  assert.match(mediaHost, /kTverWatchdogRecoveryMs = 5U \* 1000U/);
  assert.match(mediaHost, /uint64_t tverWatchdogRequestGeneration_ = 0/);
  assert.match(mediaHost, /RecoveryCoolingDown\(now\)/);
});

test('media WebView relies only on UDF-level image and font suppression', () => {
  assert.doesNotMatch(mediaHost, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_(?:IMAGE|FONT)/);
  assert.doesNotMatch(mediaHost, /AddWebResourceRequestedFilter|add_WebResourceRequested/);
  assert.match(sharedEnvironment, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(sharedEnvironment, /downloadableBinaryFontsEnabled=false/);
});

test('YouTube static presentation policy is not reinjected after navigation completes', () => {
  assert.match(mediaHost, /AddScriptToExecuteOnDocumentCreated\([\s\S]*kNativeMediaYoutubeCleanPlayerScript/);
  assert.match(
    mediaWrapper,
    /script == kNativeMediaYoutubeCleanPlayerScript[\s\S]*return kNativeMediaNoopScript/,
  );
});

test('YouTube applies 360p and captions policy once per video', () => {
  assert.match(youtubeRuntime, /videoKey/);
  assert.match(youtubeRuntime, /qualityApplied: false/);
  assert.match(youtubeRuntime, /captionsApplied: false/);
  assert.match(youtubeRuntime, /const preferredQuality = 'medium'/);
  assert.match(youtubeRuntime, /setPlaybackQualityRange\(preferredQuality, preferredQuality\)/);
  assert.doesNotMatch(youtubeRuntime, /getPlaybackQuality\(\)/);
});

test('active YouTube and TVer hot paths stay free of high-frequency diagnostic logging', () => {
  const hotPath = [tverEpisode, youtubeRuntime, mediaWrapper].join('\n');
  assert.doesNotMatch(hotPath, /console\.(?:log|debug|info)\s*\(/);
  assert.doesNotMatch(hotPath, /OutputDebugString|std::cout|std::cerr/);
});

test('playlist startup fallback is event driven with one seven-second escape hatch', () => {
  assert.match(mediaHost, /BeginYoutubePlaylistFallback\(\)/);
  assert.match(mediaHost, /ExecutePolicyScript\(webview_\.Get\(\), kNativeMediaPlayAllScript, nullptr\)/);
  assert.doesNotMatch(
    mediaBase + mediaHost,
    /kNativeMediaPlayAllTimer|kNativeMediaPlayAllRetryMs|kNativeMediaPlayAllRetryLimit|playAllProbeAttempts_|ProbePlayAll/,
  );
  assert.match(youtubePlaylistFallback, /yt-page-data-updated/);
  assert.match(youtubePlaylistFallback, /yt-navigate-finish/);
  assert.match(youtubePlaylistFallback, /7000/);
  assert.doesNotMatch(youtubePlaylistFallback, /ytInitialData|MutationObserver|setInterval\(/);
});

test('media responsibilities remain separate from radar rendering', () => {
  assert.match(mediaBase, /#include "media_host\.inc"/);
  assert.match(mediaBase, /#include "media_host_window\.inc"/);
  assert.doesNotMatch(mediaBase, /radar_section\.inc/);
  assert.match(composition, /#include "renderer_panels\/radar_section\.inc"/);
  assert.match(mediaHost, /class NativeMediaPanelHost final/);
  assert.match(mediaWindow, /LRESULT CALLBACK NativeMediaPanelWndProc/);
  assert.match(radarSection, /void Renderer::DrawRadarSection/);
});
