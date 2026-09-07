import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = readFileSync(
  new URL('../../native/src/spotify_webviews.cpp', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const phaseSync = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url), 'utf8');
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url), 'utf8');
const timed = readFileSync(
  new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url), 'utf8');
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url), 'utf8');
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url), 'utf8');
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url), 'utf8');
const mediaWrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const mediaPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');

test('six Spotify accounts share the WebView2 environment while using isolated profiles', () => {
  assert.match(header, /kAccountCount = 6/);
  assert.match(spotify, /webview2-youtube-mv/);
  assert.match(mediaPanel, /webview2-youtube-mv/);
  assert.match(spotify, /SharedWebViewEnvironment::Instance\(\)\.Acquire/);
  assert.match(spotify, /kSpotifyProfilePrefix\[\] = L"spotify-"/);
  assert.match(spotify, /std::to_wstring\(target->index \+ 1\)/);
  assert.match(spotify, /put_ProfileName\(profileName\.c_str\(\)\)/);
  assert.match(spotify, /CreateCoreWebView2ControllerWithOptions/);
  assert.doesNotMatch(spotify, /CreateCoreWebView2EnvironmentWithOptions/);
});

test('one Spotify owner gets recovery geometry while other visible controllers are parked at 1x1', () => {
  assert.match(layout, /const size_t activeIndex = staggerSlotIndex_ % slots_\.size\(\)/);
  assert.match(layout, /kSpotifySerializedRecoveryZoom = 0\.80/);
  assert.match(spotify, /int width = 1;\s*int height = 1/);
  assert.match(spotify, /const bool authentication = active && SlotIsLoginPage\(slot\)/);
  assert.match(spotify, /const bool recovery = active && !authentication && !slot\.playing/);
  assert.match(spotify, /x = client\.right \+ 32/);
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.match(spotify, /ShowWindow\(slot\.hostWindow, SW_SHOWNOACTIVATE\)/);
  assert.doesNotMatch(spotify, /SW_HIDE/);
});

test('Spotify browser behavior comes from fixed scripts and data messages, not source rewriting', () => {
  assert.match(wrapper, /#include "spotify_static_scripts\.inc"/);
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript\[\]/);
  assert.match(scripts, /kSpotifyStaticTrackReconcileScript\[\]/);
  assert.match(scripts, /kSpotifyStaticPodcastReconcileScript\[\]/);
  assert.match(scripts, /kSpotifyStaticEndObserverScript\[\]/);
  assert.match(scripts, /window\.chrome\.webview\.addEventListener\('message'/);
  assert.match(scripts, /spotify:target/);
  assert.match(recent, /PostWebMessageAsString\(message\.c_str\(\)\)/);
  assert.doesNotMatch(wrapper, /#define ExecuteScript|RewriteSpotify|spotify_viewport_recovery\.inc|spotify_lonesome_guard\.inc/);
  assert.doesNotMatch(recent, /BuildRecentTrackScript|EscapeRecentScriptLiteral/);
  assert.doesNotMatch(timed, /BuildTimedTrackScript/);
});

test('Spotify player pages reduce decorative work without blocking audio/media resources', () => {
  assert.match(scripts, /animation: none !important/);
  assert.match(scripts, /transition: none !important/);
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE/);
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
});

test('YouTube phase starts the Spotify cycle and TVer leaves an active A-B-C-D rotation intact', () => {
  assert.match(mediaPanel, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaWrapper, /SetSpotifyMediaPhase\(phase_ == Phase::Tver\)/);
  assert.match(header, /void SetPodcastMode\(bool podcastWindowActive\) noexcept/);
  assert.match(header, /void SetSpotifyMediaPhase\(bool tverPhase\) noexcept/);
  assert.match(lifecycle, /gSpotifyWebViews->SetPodcastMode\(!tverPhase\)/);
  assert.match(lifecycle, /gSpotifyWebViews->Start\(\);\s*SetSpotifyMediaPhase\(false\);/);
  assert.match(schedule, /TVer leaves the current completion-driven rotation untouched/);
  assert.doesNotMatch(schedule, /SetPodcastModeImmediate|StopLegacySchedulers/);
});

test('one direct robust scheduler serializes all six Spotify windows', () => {
  assert.match(phaseSync, /kSpotifyRobustReconcileTimer = 0x53505243/);
  assert.match(phaseSync, /kSpotifyRobustReconcileTickMs = 2U \* 1000U/);
  assert.match(phaseSync, /::SetTimer\(host, kSpotifyRobustReconcileTimer/);
  assert.match(phaseSync, /StaggeredReconcileTimerProc/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed\)/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 15ULL \* 1000ULL/);
  assert.doesNotMatch(header, /reconcileIndex_|playbackWatchdogIndex_/);
  assert.doesNotMatch(spotify, /RunPlaybackWatchdog|kSpotifyPlaybackWatchdogTimer/);
});

test('controller creation is serialized and bounded on slow machines', () => {
  assert.match(header, /ULONGLONG controllerCreateTick = 0/);
  assert.match(header, /bool controllerCreating = false/);
  assert.match(phaseSync, /kSpotifyRobustControllerRetryMs = 20ULL \* 1000ULL/);
  assert.match(phaseSync, /void SpotifyWebViews::BeginControllerCreate/);
  assert.match(phaseSync, /slot\.controllerCreating && slot\.controllerCreateTick != 0/);
  assert.match(phaseSync, /CreateController\(slot\)/);
  assert.match(spotify, /CreateController\(slots_\[0\]\)/);
  assert.doesNotMatch(spotify, /kSpotifyStartupTimer|kSpotifyModeSwitchTimer/);
});

test('music and podcast targets are passed as data to shared static reconcile scripts', () => {
  assert.match(timed, /kSpotifyLonesomeRabbitPath/);
  assert.match(timed, /kSpotifyBitterBluePath/);
  assert.match(timed, /kSpotifyTalkAboutShowPath/);
  assert.match(recent, /TimedSpotifyTarget::LonesomeRabbit[\s\S]*kind = L"music"/);
  assert.match(recent, /TimedSpotifyTarget::TalkAbout[\s\S]*kind = L"podcast"/);
  assert.match(timed, /kSpotifyStaticTrackReconcileScript/);
  assert.match(timed, /kSpotifyStaticPodcastReconcileScript/);
  assert.match(scripts, /const playbackRate = 3\.0/);
  assert.match(scripts, /__homePanelSpotifyPodcastOneShot/);
  assert.doesNotMatch(scripts, /__homePanelLonesomeRabbitLoop|ensureRepeatOne/);
});

test('trusted recovery uses CDP hover then click and never moves the OS mouse', () => {
  assert.match(header, /ParseNormalizedPoint/);
  assert.match(header, /ClickSlotNormalizedPoint/);
  assert.match(phaseSync, /RefreshSpotifyHostLayout\(\)/);
  assert.match(phaseSync, /DispatchSpotifyDevToolsClick/);
  assert.match(click, /Input\.dispatchMouseEvent/);
  assert.match(click, /mouseMoved/);
  assert.match(click, /mouseMoved[\s\S]*mousePressed[\s\S]*mouseReleased/);
  assert.doesNotMatch(click, /SendInput|ClientToScreen|MOUSEEVENTF_|SetForegroundWindow/);
});

test('all six Spotify WebViews remain natively muted', () => {
  assert.match(spotify, /ComPtr<ICoreWebView2_8> audio/);
  assert.match(spotify, /audio->put_IsMuted\(TRUE\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(slot\.webview\)/);
  assert.doesNotMatch(spotify, /put_IsMuted\(FALSE\)/);
});

test('layout is driven directly by per-slot playback messages', () => {
  assert.match(header, /bool playing = false/);
  assert.match(spotify, /put_IsWebMessageEnabled\(TRUE\)/);
  assert.match(spotify, /spotify:playing/);
  assert.match(spotify, /spotify:not-playing/);
  assert.match(spotify, /target->playing = playing/);
  assert.match(spotify, /RecomputeForeground\(\)/);
  assert.doesNotMatch(header, /foreground_/);
});

test('Spotify lifetime is independent of dashboard power-saving visibility', () => {
  assert.match(lifecycle, /std::unique_ptr<SpotifyWebViews> gSpotifyWebViews/);
  assert.match(lifecycle, /gSpotifyWebViews->Start\(\)/);
  assert.match(lifecycle, /gSpotifyWebViews->Shutdown\(\)/);
  assert.match(lifecycle, /gSpotifyWebViews->Resize\(\)/);
  const powerSavingStart = lifecycle.indexOf('void Renderer::SetPowerSavingMode');
  const visibilityStart = lifecycle.indexOf('void Renderer::ApplyDashboardVisibility');
  assert.notEqual(powerSavingStart, -1);
  assert.notEqual(visibilityStart, -1);
  assert.doesNotMatch(lifecycle.slice(powerSavingStart, visibilityStart), /gSpotifyWebViews/);
});
