import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const layout = source('sh_layout.cpp');
const playerHeader = source('sh.h');
const handles = source('app_stationhead_handles.cpp');
const webview = source('sh_webview.cpp');
const logger = source('logger.cpp');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('single Stationhead resolves placement against the parent client', () => {
  assert.match(layout, /ResolveStationheadWorkspaceBounds\(/);
  assert.match(layout, /GetClientRect\(parent, &client\)/);
  assert.match(layout, /ResolveStationheadWorkspaceBounds\(window_, bounds\)/);
});

test('background host and auth stay onscreen while stable playback may compact only its controller', () => {
  const behind = section(layout, 'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()');
  assert.match(behind, /ApplyStationheadChildLayout/);
  assert.match(behind, /AudioPlayingSince\(\)/);
  assert.match(behind, /kStationheadCompactPlaybackStabilityMs/);
  assert.doesNotMatch(behind, /trackBoundaryPlaybackRecoveryPending_/);

  const apply = section(layout, 'void ApplyStationheadChildLayout(',
    '}  // namespace');
  assert.match(apply, /const RECT surfaceBounds = StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(apply, /playbackHostBounds = surfaceBounds/);
  assert.match(apply, /authHostBounds = surfaceBounds/);
  assert.match(apply, /PlaybackControllerBounds\(playbackHostBounds, useCompactPlayback\)/);
  assert.doesNotMatch(apply, /StationheadOffscreenBounds|authOffscreen/);
  assert.ok(apply.indexOf('SetWindowPos(hostWindow') < apply.indexOf('if (controller)'));
  assert.ok(apply.indexOf('SetWindowPos(authHostWindow') < apply.indexOf('if (authController)'));
});

test('startup and reload explicitly restore the full Stationhead controller viewport', () => {
  const startup = section(layout, 'void StationheadPlayer::SetStartupBounds()',
    'void StationheadPlayer::SetStartupPreviewBounds(');
  assert.match(startup, /ApplyStationheadChildLayout\([\s\S]*false, false, false, false\)/);
  assert.doesNotMatch(startup, /AudioPlaying|compactPlayback/);
});

test('failed host creation clears public visibility', () => {
  const controllers = section(layout, 'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(');
  assert.match(controllers, /if \(!EnsureHostWindow\(\)\)[\s\S]*status_\.visible = false/);
});

test('recreating WebView is never reported as healthy audio', () => {
  const audio = section(playerHeader, '[[nodiscard]] bool AudioPlaying() const noexcept',
    '[[nodiscard]] int64_t AudioPlayingSince() const noexcept');
  assert.match(audio, /playingSince > 0/);
  assert.match(audio, /!recreating_\.load\(std::memory_order_acquire\)/);
});

test('handle status and foregrounding use live player state', () => {
  const raw = section(handles, 'StationheadStatus StationheadHandleBase::RawStatus() const',
    'StationheadStatus StationheadHandleBase::Status() const');
  assert.match(raw, /player_->AudioPlaying\(\)/);

  const raise = section(handles, 'void StationheadHandleBase::RaiseActiveHost() const',
    'void StationheadHandleBase::ApplyBounds()');
  assert.match(raise, /const StationheadStatus status = RawStatus\(\)/);
  assert.match(raise, /SetWindowPos\(host, HWND_TOP/);
  assert.match(raise, /SWP_NOMOVE \| SWP_NOSIZE/);
});

test('Spotify popup authorization survives playback recreation', () => {
  assert.match(playerHeader, /std::wstring activeAuthorizationUrl_;/);
  const popup = section(webview, 'const HRESULT newWindowResult = webview_->add_NewWindowRequested(',
    'if (FAILED(newWindowResult))');
  assert.match(popup, /CloseAuthWebView\(\);[\s\S]*activeAuthorizationUrl_ = uri/);

  const close = section(webview, 'void StationheadPlayer::CloseWebView()',
    'void StationheadPlayer::CloseAuthWebView()');
  assert.match(close, /pendingAuthorizationUrl_ = resumeUrl/);
  assert.match(close, /status_\.spotifyAuthorization = false/);
});

test('completed auth is finalized inside the single handle', () => {
  const release = section(handles, 'void StationheadHandleBase::ReleaseCompletedAuth()',
    'uint32_t StationheadHandleBase::ConsumeChangeFlags()');
  assert.match(release, /player_->FinalizeCompletedAuth\(\)/);

  const flags = section(handles, 'uint32_t StationheadHandleBase::ConsumeChangeFlags()',
    'void StationheadHandleBase::AssignPlayer(');
  assert.match(flags, /StationheadChangeReleaseAuth/);
  assert.match(flags, /player_->FinalizeCompletedAuth\(\)/);
});

test('required WebView events fail closed into recreation', () => {
  for (const result of ['newWindowResult', 'webMessageResult', 'processFailedResult']) {
    assert.match(webview, new RegExp(`if \\(FAILED\\(${result}\\)\\) \\{[\\s\\S]*ScheduleRecreate\\(`));
  }
});

test('logger redacts URL query and fragment diagnostics', () => {
  assert.match(logger, /RedactUrlQueryAndFragment/);
  assert.match(logger, /find_first_of\(L"\?#", urlAt\)/);
  assert.match(logger, /WideToUtf8\(RedactUrlQueryAndFragment\(message\)\)/);
});
