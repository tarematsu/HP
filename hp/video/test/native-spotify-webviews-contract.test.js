import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = [
  'spotify_webviews.cpp',
  'spotify_webview_foundation.inc',
  'spotify_host_lifecycle.inc',
  'spotify_controller_lifecycle.inc',
].map(name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8')).join('\n');
const header = readFileSync(new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const wrapper = readFileSync(new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const phaseSync = readFileSync(new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');
const schedule = readFileSync(new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../../native/src/spotify_host_layout.inc', import.meta.url), 'utf8');
const scripts = readFileSync(new URL('../../native/src/spotify_static_scripts.inc', import.meta.url), 'utf8');
const scoped = readFileSync(new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url), 'utf8');
const observerBundle = readFileSync(new URL('../../native/src/spotify_fast_end_observer.inc', import.meta.url), 'utf8');
const timed = readFileSync(new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url), 'utf8');
const cycle = readFileSync(new URL('../../native/src/spotify_rotation_cycle.inc', import.meta.url), 'utf8');
const music = readFileSync(new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const routing = readFileSync(new URL('../../native/src/spotify_target_routing.inc', import.meta.url), 'utf8');
const cloud = readFileSync(new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const click = readFileSync(new URL('../../native/src/spotify_background_click.inc', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url), 'utf8');
const mediaPanel = readFileSync(new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const mediaHost = readFileSync(new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');

test('six Spotify accounts share the WebView2 environment while using isolated profiles', () => {
  assert.match(header, /kAccountCount = 6/);
  assert.match(scripts, /std::array<std::wstring_view, 6> kSpotifyPanelNames/);
  assert.match(scripts, /L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata", L"ozeki"/);
  assert.match(spotify, /webview2-youtube-mv/);
  assert.match(mediaHost, /webview2-youtube-mv/);
  assert.match(spotify, /SharedWebViewEnvironment::Instance\(\)\.Acquire/);
  assert.match(spotify, /kSpotifyProfilePrefix\[\] = L"spotify-"/);
  assert.match(spotify, /std::to_wstring\(target->index \+ 1\)/);
  assert.match(spotify, /put_ProfileName\(profileName\.c_str\(\)\)/);
  assert.match(spotify, /CreateCoreWebView2ControllerWithOptions/);
  assert.doesNotMatch(spotify, /CreateCoreWebView2EnvironmentWithOptions/);
});

test('WebView implementation is composed by responsibility instead of numbered source shards', () => {
  assert.match(spotify, /SpotifyWebViews::SpotifyWebViews/);
  assert.match(spotify, /void SpotifyWebViews::Start\(\)/);
  assert.match(spotify, /void SpotifyWebViews::CreateController/);
  assert.doesNotMatch(spotify, /spotify_webviews_core_part[1-4]/);
});

test('authentication and recovery geometry are owned by the low-peak layout module', () => {
  assert.match(layout, /const size_t recoveryIndex =/);
  assert.match(layout, /hostLayoutActiveSlot_ == recoveryIndex/);
  assert.match(layout, /kSpotifySerializedRecoveryZoom = 0\.80/);
  assert.match(layout, /kSpotifyParkedPlaybackWidth = 160/);
  assert.match(layout, /kSpotifyParkedPlaybackHeight = 90/);
  assert.match(layout, /kSpotifyRecoveryInteractionWidth = 720/);
  assert.match(layout, /kSpotifyRecoveryInteractionHeight = 480/);
  assert.match(layout, /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\)/);
  assert.match(layout, /const bool recovery =\s*i == hostLayoutActiveSlot_ && !authentication &&\s*SlotStateNeedsRecovery\(slot\.state\)/);
  assert.match(layout, /const bool placementChanged = positionChanged \|\| sizeChanged \|\| zOrderChanged/);
  assert.match(layout, /if \(placementChanged\)/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter/);
  assert.doesNotMatch(layout, /ShowWindow\(slot\.hostWindow/);
  assert.match(layout, /suppressHealthyRendering/);
  assert.match(layout, /put_IsVisible\(suppressHealthyRendering \? FALSE : TRUE\)/);
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
});

test('Spotify browser behavior uses responsibility-split playback modules', () => {
  for (const file of [
    'spotify_static_scripts.inc', 'spotify_scoped_track_reconcile.inc',
    'spotify_media_observer_runtime.inc', 'spotify_media_observer_events.inc',
    'spotify_cloud_playlist.inc', 'spotify_playback_mode_guards.inc',
    'spotify_rotation_cycle.inc', 'spotify_music_target.inc',
    'spotify_target_routing.inc',
  ]) assert.match(wrapper, new RegExp(`#include "${file.replace('.', '\\.')}"`));
  assert.doesNotMatch(wrapper, /spotify_media_observer_heartbeat\.inc/);
  assert.doesNotMatch(wrapper, /spotify_recent_catalog\.inc/);
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript\[\]/);
  assert.match(scripts, /kSpotifyStaticPodcastReconcileScript\[\]/);
  assert.match(scoped, /kSpotifyScopedTrackReconcileScript/);
  assert.match(observerBundle, /kSpotifyMediaObserverRuntimeScript/);
  assert.match(observerBundle, /kSpotifyMediaObserverEventsScript/);
  assert.doesNotMatch(observerBundle, /kSpotifyMediaObserverHeartbeatScript/);
  assert.match(scripts, /window\.chrome\.webview\.addEventListener\('message'/);
  assert.match(scripts, /spotify:target/);
  assert.match(routing, /spotify:generation/);
  assert.doesNotMatch(wrapper, /#define ExecuteScript|RewriteSpotify|spotify_viewport_recovery\.inc|spotify_lonesome_guard\.inc/);
});

test('Spotify player pages reduce decorative work without blocking audio/media resources', () => {
  assert.match(scripts, /animation: none !important/);
  assert.match(scripts, /transition: none !important/);
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE/);
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
});

test('YouTube/TVer phase notification cannot mutate Spotify playback state', () => {
  assert.match(mediaPanel, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaHost, /SetSpotifyMediaPhase\(phase_ == Phase::Tver\)/);
  assert.match(lifecycle, /void SetSpotifyMediaPhase\(bool\) noexcept \{[\s\S]*Spotify intentionally ignores YouTube\/TVer phase changes/);
  assert.doesNotMatch(lifecycle + header + schedule, /gSpotifyTverPhase|SetPodcastMode|podcastMode_/);
  assert.match(spotify, /StartAutonomousSchedule\(GetTickCount64\(\)\)/);
  assert.match(schedule, /void SpotifyWebViews::StartAutonomousSchedule/);
});

test('one adaptive scheduler serializes all six Spotify windows with one shared startup offset', () => {
  assert.match(phaseSync, /kSpotifyRobustReconcileTimer = 0x53505243/);
  assert.match(phaseSync, /kSpotifyRobustUrgentTickMs = 2U \* 1000U/);
  assert.match(phaseSync, /kSpotifyRobustHealthyTickMs = 60U \* 1000U/);
  assert.match(header, /kSpotifyAccountStartOffsetMs = 40ULL \* 1000ULL/);
  assert.match(phaseSync, /NextRobustSchedulerDelayMs/);
  assert.match(phaseSync, /::SetTimer\(host, kSpotifyRobustReconcileTimer, delay/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed, slots_\.size\(\)\)/);
  assert.match(schedule, /% accountCount/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 40ULL \* 1000ULL/);
  assert.doesNotMatch(header, /reconcileIndex_|playbackWatchdogIndex_/);
});

test('controller creation is serialized and bounded on slow machines', () => {
  assert.match(header, /ULONGLONG controllerCreateTick = 0/);
  assert.match(header, /bool controllerCreating = false/);
  assert.match(phaseSync, /kSpotifyRobustControllerRetryMs = 20ULL \* 1000ULL/);
  assert.match(phaseSync, /void SpotifyWebViews::BeginControllerCreate/);
  assert.match(phaseSync, /CreateController\(slot\)/);
  assert.match(spotify, /CreateController\(slots_\[0\]\)/);
});

test('music is a generic cloud-managed descriptor while podcast stays separate', () => {
  assert.match(header, /struct RotationGroup/);
  assert.match(header, /std::vector<ManagedTrack> timedCycleTracks/);
  assert.match(cloud, /GetNamedArray\(L"rotation"\)/);
  assert.match(cloud, /GetNamedObject\(L"talkAbout"\)/);
  assert.match(header, /struct MusicTargetDescriptor/);
  assert.match(music, /MusicTargetDescriptor SpotifyWebViews::ResolveMusicTarget/);
  assert.match(music, /TimedSpotifyTarget::Music/);
  assert.match(music, /slot\.timedCycleTracks\[slot\.timedRotationPosition\]/);
  assert.match(music, /void SpotifyWebViews::ReconcileMusicTarget/);
  assert.match(timed, /void SpotifyWebViews::ReconcilePodcastSlot/);
  assert.match(routing, /kind = L"music"/);
  assert.match(routing, /kind = L"podcast"/);
  assert.match(wrapper, /#define kSpotifyStaticTrackReconcileScript kSpotifyScopedTrackReconcileScript/);
  assert.match(timed, /kSpotifyStaticPodcastReconcileScript/);
  assert.match(scripts, /target && target\.playbackRate/);
  assert.match(scripts, /__homePanelSpotifyPodcastOneShot/);
  assert.doesNotMatch(scripts, /__homePanelLonesomeRabbitLoop|ensureRepeatOne/);
});

test('rotation construction is isolated from music navigation and target routing', () => {
  assert.match(cycle, /PrepareTimedRotationCycle/);
  assert.doesNotMatch(cycle, /NavigateMusicTarget|PostSpotifyTargetDescriptorForSlot/);
  assert.match(music, /NavigateMusicTarget/);
  assert.doesNotMatch(music, /PrepareTimedRotationCycle|kind = L"podcast"/);
  assert.match(routing, /NavigateActiveTimedSlot/);
  assert.match(routing, /PostSpotifyTargetDescriptorForSlot/);
  assert.doesNotMatch(routing, /PrepareTimedRotationCycle|ReconcileMusicTarget\(Slot& slot\)/);
});

test('trusted recovery input is fully owned by the background click module', () => {
  assert.match(header, /ParseNormalizedPoint/);
  assert.match(header, /ClickSlotNormalizedPoint/);
  assert.match(click, /bool SpotifyWebViews::ParseNormalizedPoint/);
  assert.match(click, /void SpotifyWebViews::ClickSlotNormalizedPoint/);
  assert.match(click, /RefreshSpotifyHostLayout\(\)/);
  assert.match(click, /DispatchSpotifyDevToolsClick/);
  assert.match(click, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(phaseSync, /ParseNormalizedPoint|ClickSlotNormalizedPoint|DispatchSpotifyDevToolsClick/);
  assert.doesNotMatch(click, /SendInput|ClientToScreen|MOUSEEVENTF_|SetForegroundWindow/);
});

test('all six Spotify WebViews remain natively muted', () => {
  assert.match(spotify, /ComPtr<ICoreWebView2_8> audio/);
  assert.match(spotify, /audio->put_IsMuted\(TRUE\)/);
  assert.match(spotify, /SetSpotifyOutputMuted\(slot\.webview\)/);
  assert.doesNotMatch(spotify, /put_IsMuted\(FALSE\)/);
});

test('slot lifecycle uses one explicit state machine rather than an overloaded playing flag', () => {
  for (const state of ['NotCreated', 'Authenticating', 'Navigating', 'WaitingTarget', 'Playing', 'Recovering', 'Completed']) {
    assert.match(header, new RegExp(`\\b${state}\\b`));
  }
  assert.doesNotMatch(header, /bool playing = false/);
  assert.match(header, /SlotState state = SlotState::NotCreated/);
  assert.match(phaseSync, /SetSlotState/);
  assert.match(phaseSync, /MarkSlotRecovering/);
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
