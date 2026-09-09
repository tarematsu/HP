import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = [
  'spotify_webviews.cpp',
  'spotify_webviews_core_part1.inc',
  'spotify_webviews_core_part2.inc',
  'spotify_webviews_core_part3.inc',
  'spotify_webviews_core_part4.inc',
].map(name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8')).join('\n');
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
const scoped = readFileSync(
  new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url), 'utf8');
const observerBundle = readFileSync(
  new URL('../../native/src/spotify_fast_end_observer.inc', import.meta.url), 'utf8');
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

test('five Spotify accounts share the WebView2 environment while using isolated profiles', () => {
  assert.match(header, /kAccountCount = 5/);
  assert.match(scripts, /std::array<std::wstring_view, 5> kSpotifyPanelNames/);
  assert.match(scripts, /L"amazon", L"ten", L"nagi", L"hinata", L"ozeki"/);
  assert.doesNotMatch(scripts, /yuukiar/);
  assert.match(spotify, /webview2-youtube-mv/);
  assert.match(mediaPanel, /webview2-youtube-mv/);
  assert.match(spotify, /SharedWebViewEnvironment::Instance\(\)\.Acquire/);
  assert.match(spotify, /kSpotifyProfilePrefix\[\] = L"spotify-"/);
  assert.match(spotify, /std::to_wstring\(target->index \+ 1\)/);
  assert.match(spotify, /put_ProfileName\(profileName\.c_str\(\)\)/);
  assert.match(spotify, /CreateCoreWebView2ControllerWithOptions/);
  assert.doesNotMatch(spotify, /CreateCoreWebView2EnvironmentWithOptions/);
});

test('authentication and recovery geometry are owned by the layout module', () => {
  assert.match(layout, /const size_t recoveryIndex =/);
  assert.match(layout, /hostLayoutActiveSlot_ == recoveryIndex/);
  assert.match(layout, /kSpotifySerializedRecoveryZoom = 0\.80/);
  assert.match(layout, /kSpotifyParkedPlaybackWidth = 320/);
  assert.match(layout, /kSpotifyParkedPlaybackHeight = 180/);
  assert.match(layout, /kSpotifyRecoveryInteractionWidth = 720/);
  assert.match(layout, /kSpotifyRecoveryInteractionHeight = 480/);
  assert.match(
    layout,
    /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\)/,
  );
  assert.match(
    layout,
    /const bool recovery =\s*i == hostLayoutActiveSlot_ && !authentication &&\s*SlotStateNeedsRecovery\(slot\.state\)/,
  );
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.match(layout, /ShowWindow\(slot\.hostWindow, SW_SHOWNOACTIVATE\)/);
  assert.doesNotMatch(layout, /int width = 1;\s*int height = 1/);
  assert.doesNotMatch(spotify, /kSpotifyParkedPlaybackWidth|kSpotifyRecoveryInteractionWidth/);
});

test('Spotify browser behavior uses scoped music reconcile and responsibility-split observer modules', () => {
  assert.match(wrapper, /#include "spotify_static_scripts\.inc"/);
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.match(wrapper, /#include "spotify_media_observer_runtime\.inc"/);
  assert.match(wrapper, /#include "spotify_media_observer_events\.inc"/);
  assert.match(wrapper, /#include "spotify_media_observer_heartbeat\.inc"/);
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript\[\]/);
  assert.match(scripts, /kSpotifyStaticPodcastReconcileScript\[\]/);
  assert.doesNotMatch(scripts, /kSpotifyStaticTrackReconcileScript|kSpotifyStaticEndObserverScript/);
  assert.match(scoped, /kSpotifyScopedTrackReconcileScript/);
  assert.match(observerBundle, /kSpotifyMediaObserverRuntimeScript/);
  assert.match(observerBundle, /kSpotifyMediaObserverEventsScript/);
  assert.match(observerBundle, /kSpotifyMediaObserverHeartbeatScript/);
  assert.match(scripts, /window\.chrome\.webview\.addEventListener\('message'/);
  assert.match(scripts, /spotify:target/);
  assert.match(recent, /spotify:generation/);
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
});

test('one adaptive scheduler serializes all five Spotify windows', () => {
  assert.match(phaseSync, /kSpotifyRobustReconcileTimer = 0x53505243/);
  assert.match(phaseSync, /kSpotifyRobustUrgentTickMs = 2U \* 1000U/);
  assert.match(phaseSync, /kSpotifyRobustHealthyTickMs = 20U \* 1000U/);
  assert.match(phaseSync, /NextRobustSchedulerDelayMs/);
  assert.match(phaseSync, /::SetTimer\(host, kSpotifyRobustReconcileTimer, delay/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed, slots_\.size\(\)\)/);
  assert.match(schedule, /accountCount \* kSpotifyTimedSlotOffsetMs/);
  assert.match(schedule, /% accountCount/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 20ULL \* 1000ULL/);
  assert.match(schedule, /owner->ArmRobustScheduler\(\)/);
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
});

test('music and podcast targets are passed as data to shared reconcile implementations', () => {
  assert.match(timed, /kSpotifyLonesomeRabbitPath/);
  assert.match(timed, /kSpotifyBitterBluePath/);
  assert.match(timed, /kSpotifyTalkAboutShowPath/);
  assert.match(recent, /TimedSpotifyTarget::LonesomeRabbit[\s\S]*kind = L"music"/);
  assert.match(recent, /TimedSpotifyTarget::TalkAbout[\s\S]*kind = L"podcast"/);
  assert.match(wrapper, /#define kSpotifyStaticTrackReconcileScript kSpotifyScopedTrackReconcileScript/);
  assert.match(timed, /kSpotifyStaticPodcastReconcileScript/);
  assert.match(scripts, /const playbackRate = 3\.0/);
  assert.match(scripts, /__homePanelSpotifyPodcastOneShot/);
  assert.doesNotMatch(scripts, /__homePanelLonesomeRabbitLoop|ensureRepeatOne/);
});

test('trusted recovery input is fully owned by the background click module', () => {
  assert.match(header, /ParseNormalizedPoint/);
  assert.match(header, /ClickSlotNormalizedPoint/);
  assert.match(click, /bool SpotifyWebViews::ParseNormalizedPoint/);
  assert.match(click, /void SpotifyWebViews::ClickSlotNormalizedPoint/);
  assert.match(click, /RefreshSpotifyHostLayout\(\)/);
  assert.match(click, /DispatchSpotifyDevToolsClick/);
  assert.match(click, /Input\.dispatchMouseEvent/);
  assert.match(click, /mouseMoved[\s\S]*mousePressed[\s\S]*mouseReleased/);
  assert.doesNotMatch(phaseSync, /ParseNormalizedPoint|ClickSlotNormalizedPoint|DispatchSpotifyDevToolsClick/);
  assert.doesNotMatch(click, /SendInput|ClientToScreen|MOUSEEVENTF_|SetForegroundWindow/);
});

test('all five Spotify WebViews remain natively muted', () => {
  assert.match(spotify, /ComPtr<ICoreWebView2_8> audio/);
  assert.match(spotify, /audio->put_IsMuted\(TRUE\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(slot\.webview\)/);
  assert.doesNotMatch(spotify, /put_IsMuted\(FALSE\)/);
});

test('slot lifecycle uses one explicit state machine rather than an overloaded playing flag', () => {
  for (const state of [
    'NotCreated', 'Authenticating', 'Navigating', 'WaitingTarget',
    'Playing', 'Recovering', 'Completed',
  ]) {
    assert.match(header, new RegExp(`\\b${state}\\b`));
  }
  assert.doesNotMatch(header, /bool playing = false/);
  assert.match(header, /SlotState state = SlotState::NotCreated/);
  assert.match(phaseSync, /SetSlotState/);
  assert.match(phaseSync, /MarkSlotRecovering/);
  assert.match(phaseSync, /unhealthySinceTick/);
  assert.match(layout, /SlotStateIsHealthy/);
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
