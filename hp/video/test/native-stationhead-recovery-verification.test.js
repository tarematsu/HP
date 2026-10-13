import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const player = source('sh.cpp');
const webview = source('sh_webview.cpp');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const recovery = source('sh_track_boundary_message_policy.h');
const eventPolicy = source('sh_webview_event_policy.h');

test('Stationhead does not promote a native-audio pulse to healthy playback', () => {
  const gate = player.indexOf(
    'if (playing &&\n      source != L"WebView2 + media clock" &&\n      source != L"media clock")',
  );
  const exchange = player.indexOf('audioPlaying_.exchange(playing');
  assert.notEqual(gate, -1);
  assert.notEqual(exchange, -1);
  assert.ok(gate < exchange);
  assert.match(player, /window\.__homepanelAudioPlaying = false/);

  assert.match(webview, /ApplyAudioPlaybackState\(playing != FALSE, L"WebView2"\)/);
  assert.match(webview, /ApplyAudioPlaybackState\(playing != FALSE, L"WebView2 initial"\)/);
  assert.match(
    recovery,
    /ApplyAudioPlaybackState\([\s\S]*nativePlaying != FALSE, L"1-minute native audio health check"\)/,
  );
  assert.match(player, /L"post-navigation native confirmation"/);
});

test('Stationhead requires same-media clock advancement before native confirmation', () => {
  const baseline = lifecycle.indexOf('else if (progressMedia !== media)');
  const progress = lifecycle.indexOf('else if (current > progressTime + 0.10)');
  assert.notEqual(baseline, -1);
  assert.notEqual(progress, -1);
  assert.ok(baseline < progress);
  assert.match(lifecycle, /postText\('media-progress'\)/);
  assert.match(
    lifecycle,
    /window\.__homepanelAudioPlaying !== true[\s\S]*postText\('media-progress'\)/,
  );
});

test('Stationhead media-progress confirmation rechecks WebView2 audio fail-closed', () => {
  assert.match(webview, /message == prefix \+ L"-media-progress"/);
  assert.match(webview, /get_IsDocumentPlayingAudio\([\s\S]*&nativePlaying/);
  assert.match(
    webview,
    /nativePlaying != FALSE[\s\S]*L"WebView2 \+ media clock"/,
  );
  assert.match(webview, /L"media clock without native audio"/);
  assert.match(player, /source != L"WebView2 \+ media clock"/);
  assert.match(player, /source != L"media clock"/);
});

test('Stationhead track-boundary recovery stays armed after an unverified native pulse', () => {
  const postNavigation = player.indexOf('L"post-navigation native confirmation"');
  const verifiedCheck = player.indexOf(
    'if (!audioPlaying_.load(std::memory_order_relaxed))',
    postNavigation,
  );
  const deadline = player.indexOf(
    'nowMs + kStationheadTrackBoundaryPlaybackRecoveryTimeoutMs',
    verifiedCheck,
  );
  assert.notEqual(postNavigation, -1);
  assert.notEqual(verifiedCheck, -1);
  assert.notEqual(deadline, -1);
  assert.ok(postNavigation < verifiedCheck && verifiedCheck < deadline);
});

test('Stationhead audio-change events do not run an independent recovery loop', () => {
  assert.match(eventPolicy, /WrapStationheadAudioChangedHandler/);
  assert.match(eventPolicy, /return InvokeEventNoexcept\(inner, sender, args\)/);
  assert.doesNotMatch(eventPolicy, /UpdateStationheadSilentPlaybackRecovery/);
  assert.doesNotMatch(eventPolicy, /__homepanelStationheadSilentRecoveryTimer/);
  assert.doesNotMatch(eventPolicy, /nativeSetTimeout|nativeSetInterval|nativeClearInterval/);
  assert.doesNotMatch(eventPolicy, /media\.pause\(\)|media\.play\?\.\(\)/);
  assert.match(recovery, /RecoveryStage::LightRepair/);
  assert.match(recovery, /AttemptNativeStartClick\(nowMs\)/);
});

test('Stationhead recovery verification does not reintroduce PCM or Core Audio peak checks', () => {
  for (const text of [player, webview, lifecycle, eventPolicy]) {
    assert.doesNotMatch(text, /IAudioMeterInformation/);
    assert.doesNotMatch(text, /GetPeakValue/);
    assert.doesNotMatch(text, /PCM peak/i);
  }
});

test('six persistent Stationhead WebViews avoid redundant steady audio scripts and UI notifications', () => {
  const from = player.indexOf('void StationheadPlayer::ApplyAudioPlaybackState(');
  const to = player.indexOf('void StationheadPlayer::NavigateCurrentUrl(', from);
  assert.ok(from >= 0 && to > from);
  const apply = player.slice(from, to);
  assert.match(apply, /const bool changed =\s*audioPlaying_\.exchange\(playing, std::memory_order_relaxed\) != playing/);
  assert.match(apply, /if \(webview_ && changed\) \{\s*webview_->ExecuteScript\(/);
  assert.match(apply, /if \(changed \|\| awaitingTrackBoundaryNavigation \|\|[\s\S]*preserveLoginRequired\) \{\s*PostChange\(/);
  assert.match(apply, /if \(changed\) PostChange\(\)/);
  // No short circuit before resetting audio-loss state or honoring recovery and
  // login activity: only the redundant JS bridge/notification are suppressed.
  assert.match(apply, /ResetAudioLossEscalation\(\)/);
  assert.match(apply, /status_\.loginRequired = preserveLoginRequired/);
  assert.match(apply, /audioPlayingSinceAt_\.store\(0, std::memory_order_relaxed\)/);
});


test('steady Stationhead media-clock confirmations repair hidden surfaces only every minute', () => {
  const from = player.indexOf('void StationheadPlayer::ApplyAudioPlaybackState(');
  const to = player.indexOf('void StationheadPlayer::NavigateCurrentUrl(', from);
  const apply = player.slice(from, to);
  assert.match(player, /constexpr uint64_t kStationheadHealthySurfaceRepairIntervalMs = 60'000/);
  assert.match(player, /lastHealthySurfaceRepairTick_ = 0;/);
  assert.match(apply,
    /if \(!preserveLoginRequired && !startupPreviewActive_ && !spotifyAuthorization_\) \{/);
  assert.match(apply, /viewVisible_ \|\| selectedTab_ != StationheadTabKind::None \|\|/);
  assert.match(apply, /lastHealthySurfaceRepairTick_ == 0 \|\|/);
  assert.match(apply, /nowTick - lastHealthySurfaceRepairTick_ >=\s*kStationheadHealthySurfaceRepairIntervalMs/);
  assert.match(apply, /lastHealthySurfaceRepairTick_ = nowTick;\s*SetVisible\(false\)/);
  assert.match(apply, /ResetAudioLossEscalation\(\)/);
  assert.match(apply, /status_\.loginRequired = preserveLoginRequired/);
  const needsRepair = ({ login = false, startup = false, auth = false,
    visible = false, tab = 'none', last = 1000, now = 1500 } = {}) =>
    !login && !startup && !auth &&
      (visible || tab !== 'none' || last === 0 || now - last >= 60000);
  assert.equal(needsRepair(), false, 'steady audio must not inspect six hidden surfaces');
  assert.equal(needsRepair({ visible: true }), true, 'interactive window retires immediately');
  assert.equal(needsRepair({ tab: 'stationhead' }), true, 'foreground tab retires immediately');
  assert.equal(needsRepair({ last: 0 }), true, 'startup validates hidden surface');
  assert.equal(needsRepair({ last: 1000, now: 60999 }), false);
  assert.equal(needsRepair({ last: 1000, now: 61000 }), true,
    'external layout drift is repaired after a bounded interval');
  assert.equal(needsRepair({ login: true, visible: true }), false,
    'login surface remains interactive');
  assert.equal(needsRepair({ startup: true, visible: true }), false,
    'startup preview remains interactive');
  assert.equal(needsRepair({ auth: true, visible: true }), false,
    'Spotify authorization keeps control of its surface');
});
