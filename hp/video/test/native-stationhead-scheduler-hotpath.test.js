import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = file => readFileSync(
  new URL('../../native/src/' + file, import.meta.url), 'utf8',
);
const app = native('app.cpp');
const appMessages = native('app_messages.cpp');
const playerHeader = native('sh.h');
const player = native('sh.cpp');
const handlesHeader = native('app_stationhead_handles.h');
const handles = native('app_stationhead_handles.cpp');
const audioLoss = native('sh_audio_loss.cpp');

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Expected function boundaries: ' + start);
  return source.slice(a, b);
}

test('App recovery scheduler reads six compact booleans without copying Stationhead URLs', () => {
  const tick = section(app, 'void App::Tick() {', 'void App::PerformPostRestartClick() {');
  assert.match(tick, /std::array<bool, kStationheadPeerCount> peerNeedsFastTick\{\}/);
  assert.match(tick, /peerNeedsFastTick\[i\] = stationheadPeers_\[i\]->NeedsFastTick\(\)/);
  assert.match(tick, /primaryNeedsFastTick = stationhead_->NeedsFastTick\(\)/);
  assert.match(tick, /if \(peerNeedsFastTick\[i\]\)/);
  assert.match(tick, /if \(primaryNeedsFastTick\)/);
  assert.doesNotMatch(tick, /StationheadStatus|->Status\(\)/,
    '2s recovery scheduler must not clone URLs, fallback URLs or diagnostic details');
  assert.match(tick, /NextDelayFromDeadline\(now, stationhead_->NextWakeAt\(\), kMaxAppTimerMs\)/);
});

test('compact scheduler flags are obtained under one status lock with atomic audio validity', () => {
  assert.match(playerHeader, /struct SchedulerState \{/);
  for (const name of ['audioPlaying', 'loginRequired', 'spotifyAuthorization',
    'processFailed', 'visible', 'created', 'navigating']) {
    assert.match(playerHeader, new RegExp('bool ' + name + ' = false;'));
  }
  const flags = section(player,
    'StationheadPlayer::SchedulerState StationheadPlayer::ReadSchedulerState() const {',
    'void StationheadPlayer::ResetNavigationRouteState() {');
  assert.match(flags, /std::lock_guard lock\(mutex_\)/);
  assert.match(flags, /AudioPlaying\(\), status_\.loginRequired, spotifyAuthorization_/);
  assert.match(flags, /status_\.processFailed, status_\.visible/);
  assert.doesNotMatch(flags, /std::wstring|StationheadStatus copy|status_;/);
  assert.match(handlesHeader, /\[\[nodiscard\]\] bool NeedsFastTick\(\) const/);
});

test('six-profile audio-loss watchdog uses compact flags without cloning status strings', () => {
  const state = section(audioLoss,
    'void StationheadPlayer::EvaluateAudioLossRecovery(int64_t nowMs) {',
    '}  // namespace hp');
  assert.match(state, /const SchedulerState candidate = ReadSchedulerState\(\)/);
  assert.match(state, /const SchedulerState snapshot = ReadSchedulerState\(\)/);
  assert.doesNotMatch(state, /StationheadStatus|\bStatus\(\)/,
    'audio recovery only needs authentication and navigation flags');
  assert.match(state, /snapshot\.created/);
  assert.match(state, /snapshot\.navigating/);
  assert.match(state, /snapshot\.processFailed/);
  assert.match(state, /snapshot\.loginRequired \|\| snapshot\.spotifyAuthorization/);
  assert.match(state, /BeginAudioLossAuthProbe\(nowMs\)/);
  assert.match(state, /StationheadAudioLossCanFallback\(/);
});

test('fast scheduler maintains transition grace, interactive overrides, and content revision', () => {
  const scheduler = section(handles,
    'bool StationheadHandleBase::NeedsFastTick() const {',
    'int64_t StationheadHandleBase::NextWakeAt() const noexcept');
  assert.match(scheduler, /state\.loginRequired \|\| state\.spotifyAuthorization \|\| state\.processFailed/);
  assert.match(scheduler, /SuppressTrackTransitionGap\(state\.audioPlaying, interactive\)/);
  assert.match(scheduler, /if \(suppressed && state\.visible\) player_->KeepPlaybackBehindDashboard\(\)/);
  assert.match(scheduler, /transitionSuppressed_ = suppressed;\s*\+\+contentRevision_/);
  assert.match(scheduler, /return interactive \|\| \(!state\.audioPlaying && !suppressed\)/);
});

test('Stationhead visibility refresh consumes only lifecycle flags on placement wakes', () => {
  const visibility = section(handles,
    'void StationheadHandleBase::RefreshVisibility() {',
    'void StationheadHandleBase::Start() {');
  assert.match(visibility, /const auto state = player_->ReadSchedulerState\(\)/);
  assert.match(visibility, /SuppressTrackTransitionGap\(state\.audioPlaying, interactive\)/);
  assert.match(visibility, /state\.loginRequired \|\| state\.spotifyAuthorization \|\| state\.processFailed/);
  assert.match(visibility, /if \(state\.visible\) player_->KeepPlaybackBehindDashboard\(\)/);
  assert.match(visibility, /player_->SelectTab\(StationheadTabKind::None\)/);
  assert.doesNotMatch(visibility, /RawStatus\(\)|StationheadStatus|player_->Status\(\)/);
});

test('Stationhead foreground maintenance avoids redundant topmost window operations', () => {
  const foreground = section(handles,
    'void StationheadHandleBase::RaiseActiveHost() const {',
    'void StationheadHandleBase::ApplyBounds() {');
  assert.match(foreground, /player_->ReadSchedulerState\(\)/);
  assert.doesNotMatch(foreground, /RawStatus\(\)/);
  assert.match(foreground,
    /if \(!IsWindowVisible\(host\) \|\| GetWindow\(host, GW_HWNDPREV\) != nullptr\) \{/);
  assert.match(foreground, /if \(interactive\) BringMainWindowToFront\(host\)/);
});


test('unchanged WM_SIZE avoids rebuilding dashboard and six WebView layouts', () => {
  const resize = section(appMessages,
    '    case WM_SIZE:', '    case WM_LBUTTONUP:');
  assert.match(resize, /rendererStarted_ && selectedTab_ == WorkspaceTab::Main/);
  assert.match(resize, /workspaceBounds_\.right - workspaceBounds_\.left == width/);
  assert.match(resize, /workspaceBounds_\.bottom - workspaceBounds_\.top == height/);
  assert.match(resize, /return 0;/);
  assert.ok(resize.indexOf('return 0;') < resize.indexOf('renderer_->Resize('));
  assert.match(resize, /renderer_->Resize\(LOWORD\(lParam\), HIWORD\(lParam\)\);\s*LayoutWorkspace\(\)/);
  assert.match(resize, /wParam != SIZE_MINIMIZED/);
  // A genuine resize and the initial/deferred layout still reach the normal path.
  assert.match(app, /void App::LayoutWorkspace\(\) \{/);
});
