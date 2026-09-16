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
const cycle = readFileSync(new URL('../../native/src/spotify_rotation_cycle.inc', import.meta.url), 'utf8');
const music = readFileSync(new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const routing = readFileSync(new URL('../../native/src/spotify_target_routing.inc', import.meta.url), 'utf8');
const cloud = readFileSync(new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const click = readFileSync(new URL('../../native/src/spotify_background_click.inc', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url), 'utf8');
const mediaPanel = readFileSync(new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const mediaHost = readFileSync(new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');

test('yuukiar, ten, nagi and hinata keep their existing isolated profiles', () => {
  assert.match(header, /kSpotifyProfileFirstAccountNumber = 2/);
  assert.match(header, /kSpotifyActiveAccountCount = 4/);
  assert.match(header, /kAccountCount = kSpotifyActiveAccountCount/);
  assert.match(scripts, /std::array<std::wstring_view, kSpotifyActiveAccountCount> kSpotifyPanelNames/);
  assert.match(scripts, /L"yuukiar"/);
  assert.match(scripts, /L"ten"/);
  assert.match(scripts, /L"nagi"/);
  assert.match(scripts, /L"hinata"/);
  assert.doesNotMatch(scripts, /L"amazon"|L"ozeki"/);
  assert.match(spotify, /webview2-youtube-mv/);
  assert.match(mediaHost, /webview2-youtube-mv/);
  assert.match(spotify, /SharedWebViewEnvironment::Instance\(\)\.Acquire/);
  assert.match(spotify, /kSpotifyProfilePrefix\[\] = L"spotify-"/);
  assert.match(spotify, /target->index \+ kSpotifyProfileFirstAccountNumber/);
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

test('Spotify keeps full-client internal surfaces and exposes only the selected monitor runtime lane full-size', () => {
  assert.match(layout, /const size_t recoveryIndex =/);
  assert.match(layout, /hostLayoutActiveSlot_ == recoveryIndex/);
  assert.match(layout, /kSpotifySurfaceZoom = 0\.50/);
  assert.match(layout, /put_ZoomFactor\(kSpotifySurfaceZoom\)/);
  assert.doesNotMatch(layout, /kSpotifySerializedRecoveryZoom/);
  assert.doesNotMatch(layout, /kSpotifyParkedPlaybackWidth|kSpotifyParkedPlaybackHeight/);
  assert.doesNotMatch(layout, /kSpotifyLowPowerPlaybackWidth|kSpotifyLowPowerPlaybackHeight/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
  assert.match(layout, /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\)/);
  assert.match(layout, /const bool monitorForeground =\s*SpotifyRuntimeLaneForAccount\(i\) == monitorForegroundSlot_/);
  assert.match(layout, /const int hostX = client\.left;/);
  assert.match(layout, /const int hostY = client\.top;/);
  assert.match(layout, /const int width = std::max\(1L, client\.right - client\.left\);/);
  assert.match(layout, /const int height = std::max\(1L, client\.bottom - client\.top\);/);
  assert.match(layout, /monitorForeground \|\| authenticationForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(layout, /ApplySpotifyHostVisualClip\([\s\S]*authentication \|\| monitorForeground\)/);
  assert.match(header, /int monitorForegroundSlot_ = -1/);
  assert.match(layout, /void SpotifyWebViews::SetMonitorForegroundSlot\(int slotIndex\) noexcept/);
  assert.doesNotMatch(layout, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(layout, /else if \(authentication\)|activeWidth|activeHeight/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /else if \(recovery\)/);
  assert.match(layout, /const bool placementChanged = positionChanged \|\| sizeChanged \|\| zOrderChanged/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter/);
  assert.doesNotMatch(layout, /ShowWindow\(slot\.hostWindow/);
  assert.doesNotMatch(layout, /shuffleOffVerified|repeatOffVerified/);
  assert.doesNotMatch(spotify, /ApplySpotifyPermanentLowMemoryMode|put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(spotify, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(spotify, /slot\.controller->put_IsVisible\(FALSE\)/);
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
});

test('Spotify browser behavior uses responsibility-split playback modules', () => {
  for (const file of [
    'spotify_static_scripts.inc', 'spotify_scoped_track_reconcile.inc',
    'spotify_media_observer_runtime.inc', 'spotify_media_observer_events.inc',
    'spotify_cloud_playlist.inc', 'spotify_rotation_cycle.inc',
    'spotify_music_target.inc', 'spotify_target_routing.inc',
  ]) assert.match(wrapper, new RegExp(`#include "${file.replace('.', '\\.')}"`));
  assert.doesNotMatch(wrapper, /spotify_playback_mode_guards\.inc/);
  assert.doesNotMatch(wrapper, /spotify_media_observer_heartbeat\.inc/);
  assert.doesNotMatch(wrapper, /spotify_recent_catalog\.inc/);
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript\[\]/);
  assert.match(scoped, /kSpotifyScopedTrackReconcileScript/);
  assert.match(observerBundle, /kSpotifyMediaObserverRuntimeScript/);
  assert.match(observerBundle, /kSpotifyMediaObserverEventsScript/);
  assert.doesNotMatch(observerBundle, /kSpotifyMediaObserverHeartbeatScript/);
  assert.match(scripts, /window\.chrome\.webview\.addEventListener\('message'/);
  assert.match(scripts, /spotify:target/);
  assert.match(routing, /spotify:generation/);
  assert.doesNotMatch(wrapper, /#define ExecuteScript|RewriteSpotify|spotify_viewport_recovery\.inc|spotify_lonesome_guard\.inc/);
});

test('Spotify player pages receive no injected CSS and no network resource blocking', () => {
  assert.doesNotMatch(scripts, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(scripts, /__homePanelSpotifyStaticLightweight/);
  assert.doesNotMatch(scripts, /!important/);
  assert.doesNotMatch(scripts, /animation\s*:|transition\s*:|background-image\s*:/);
  assert.doesNotMatch(scripts, /display\s*:|visibility\s*:|pointer-events\s*:|content-visibility\s*:/);
  assert.doesNotMatch(spotify, /Network\.setBlockedURLs/);
  assert.doesNotMatch(spotify, /kSpotifyBlockedDecorativeUrls|kSpotifyUnblockedDecorativeUrls/);
  assert.doesNotMatch(spotify, /SetSpotifyDecorativeResourceBlocking/);
  assert.doesNotMatch(spotify, /AddWebResourceRequestedFilter/);
  assert.doesNotMatch(spotify, /CreateWebResourceResponse/);
  assert.doesNotMatch(header, /webResourceRequestedToken/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_/);
});

test('Spotify uses in-page track routing before full Navigate fallback', () => {
  assert.match(scripts, /kSpotifySpaRouteScript/);
  assert.match(scripts, /link\.click\(\)/);
  assert.match(music, /ExecuteScript\(\s*kSpotifySpaRouteScript/);
  assert.match(music, /requestedView->Navigate\(currentTrack->url\.c_str\(\)\)/);
});

test('YouTube/TVer phase notification cannot mutate Spotify playback state', () => {
  assert.match(mediaPanel, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaHost, /SetSpotifyMediaPhase\(phase_ == Phase::Tver\)/);
  assert.match(lifecycle, /void SetSpotifyMediaPhase\(bool\) noexcept \{[\s\S]*Spotify intentionally ignores YouTube\/TVer phase changes/);
  assert.doesNotMatch(lifecycle + header + schedule, /gSpotifyTverPhase/);
  assert.match(spotify, /StartAutonomousSchedule\(GetTickCount64\(\)\)/);
  assert.match(schedule, /void SpotifyWebViews::StartAutonomousSchedule/);
});

test('one adaptive threadpool timer services the state queue and exact deadlines', () => {
  assert.match(header, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.match(header, /std::atomic<bool> schedulerWakePosted_\{false\}/);
  assert.match(header, /kSpotifyAccountStartOffsetMs = 30ULL \* 1000ULL/);
  assert.match(phaseSync, /kSpotifySchedulerBootstrapMs = 2U \* 1000U/);
  assert.match(phaseSync, /kSpotifyHealthyAuditMs = 60U \* 60U \* 1000U/);
  assert.match(phaseSync, /kSpotifyRecoveryRetryMs = 5ULL \* 1000ULL/);
  assert.match(phaseSync, /NextRobustSchedulerDelayMs/);
  assert.match(phaseSync, /CreateThreadpoolTimer\([\s\S]*SchedulerTimerProc/);
  assert.match(phaseSync, /SetThreadpoolTimer\(schedulerTimer_, &due, 0, 0\)/);
  assert.match(schedule, /SlotState is the queue/);
  assert.match(schedule, /const size_t scanStart = \(schedulerCursor_ \+ 1\) % count/);
  assert.match(schedule, /healthyPlaybackNeedsNoWork\(candidate\)/);
  assert.doesNotMatch(phaseSync + schedule, /::SetTimer\(|KillTimer\(|StaggeredReconcileTimerProc/);
  assert.doesNotMatch(schedule, /SimpleSpotifyScheduledIndex|kSpotifySimpleSteadyTurnMs|kSpotifySimpleRecoveryHoldMs/);
  assert.doesNotMatch(header, /staggerSlotIndex_|staggerSlotStartTick_|staggerSlotValidated_|reconcileIndex_|playbackWatchdogIndex_/);
});

test('controller creation is serialized and bounded on slow machines', () => {
  assert.match(header, /ULONGLONG controllerCreateTick = 0/);
  assert.match(header, /bool controllerCreating = false/);
  assert.match(phaseSync, /kSpotifyControllerRetryMs = 20ULL \* 1000ULL/);
  assert.match(phaseSync, /void SpotifyWebViews::BeginControllerCreate/);
  assert.match(phaseSync, /CreateController\(slot\)/);
  assert.doesNotMatch(spotify, /CreateController\(slots_\[0\]\)/);
  assert.match(schedule, /kSpotifyInitialStartDelayMs = 0/);
  assert.match(schedule, /BeginControllerCreate\(slot\)/);
});

test('all managed Spotify targets use the current ManagedTrack as the single target source', () => {
  assert.doesNotMatch(header, /TimedSpotifyTarget|MusicTargetDescriptor|timedPlaybackStartTick/);
  assert.doesNotMatch(header, /BitterBlue|Monshirocho|Munen|OnMyWay|LonesomeRabbit|CatalogTrack/);
  assert.match(header, /struct RotationGroup/);
  assert.match(header, /std::vector<ManagedTrack> timedCycleTracks/);
  assert.match(cloud, /GetNamedArray\(L"rotation"\)/);
  assert.match(header, /const ManagedTrack\* CurrentMusicTrack/);
  assert.match(music, /const SpotifyWebViews::ManagedTrack\* SpotifyWebViews::CurrentMusicTrack/);
  assert.match(music, /slot\.timedCycleTracks\[slot\.timedRotationPosition\]/);
  assert.match(music, /void SpotifyWebViews::ReconcileMusicTarget/);
  assert.match(routing, /CurrentMusicTrack\(slot\)/);
  assert.doesNotMatch(routing, /pagePath|trackPath|kind = L"music"/);
  assert.match(music, /ExecuteScript\(\s*kSpotifyScopedTrackReconcileScript/);
  assert.doesNotMatch(wrapper, /#define kSpotifyStaticTrackReconcileScript/);
  assert.doesNotMatch(scripts, /__homePanelLonesomeRabbitLoop|ensureRepeatOne/);
});

test('rotation construction is isolated from music navigation and starts each account at A/B/C/D', () => {
  assert.match(cycle, /PrepareTimedRotationCycle/);
  assert.match(cycle, /const size_t startGroupIndex = slot\.index % cloudRotationGroups_\.size\(\)/);
  assert.match(cycle, /\(startGroupIndex \+ offset\) % cloudRotationGroups_\.size\(\)/);
  assert.match(cycle, /appendGroup\(cloudRotationGroups_\[groupIndex\], groupIndex\)/);
  assert.doesNotMatch(cycle, /NavigateMusicTarget|PostSpotifyTargetDescriptorForSlot/);
  assert.match(music, /NavigateMusicTarget/);
  assert.doesNotMatch(music, /PrepareTimedRotationCycle/);
  assert.match(routing, /PostSpotifyTargetDescriptorForSlot/);
  assert.doesNotMatch(routing, /NavigateActiveTimedSlot|ReconcileActiveTimedSlot/);
  assert.doesNotMatch(routing, /PrepareTimedRotationCycle|ReconcileMusicTarget\(Slot& slot\)/);
});

test('trusted recovery input is fully owned by the background click module', () => {
  assert.match(header, /ParseCssPoint/);
  assert.match(header, /ClickSlotCssPoint/);
  assert.match(click, /bool SpotifyWebViews::ParseCssPoint/);
  assert.match(click, /void SpotifyWebViews::ClickSlotCssPoint/);
  assert.match(click, /PlaceHosts\(\)/);
  assert.match(click, /DispatchSpotifyDevToolsClick/);
  assert.match(click, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(phaseSync, /ParseCssPoint|ClickSlotCssPoint|DispatchSpotifyDevToolsClick/);
  assert.doesNotMatch(click, /SendInput|ClientToScreen|MOUSEEVENTF_|SetForegroundWindow|get_ZoomFactor|GetDpiForWindow|cssWidth|cssHeight/);
});

test('Spotify defaults muted and audio modes B/C/D select exactly one runtime lane', () => {
  assert.match(header, /kSpotifyActiveAccountCount = 4/);
  assert.match(header, /void SetAudioOutputSlot\(int slotIndex\) noexcept/);
  assert.match(header, /int SlotIndexForWebView\(ICoreWebView2\* webview\) const noexcept/);
  assert.match(spotify, /int gSpotifyAudioOutputSlot = -1/);
  assert.match(spotify, /runtimeLane != gSpotifyAudioOutputSlot/);
  assert.match(spotify, /SpotifyRuntimeLaneForAccount/);
  assert.match(spotify, /void SetSpotifyAudioOutputSlot\(int slotIndex\) noexcept/);
  assert.match(spotify, /SetSpotifyOutputMuted\(slot\.webview\)/);
});

test('slot lifecycle uses one explicit state machine rather than an overloaded playing flag', () => {
  for (const state of ['NotCreated', 'Authenticating', 'Navigating', 'WaitingTarget', 'Playing', 'Recovering']) {
    assert.match(header, new RegExp(`\\b${state}\\b`));
  }
  assert.doesNotMatch(header, /\bCompleted\b|bool playing = false/);
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
