import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const audioLoss = readFileSync(
  new URL('../../native/src/sh_audio_loss.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('Stationhead playback host uses the media panel for a named monitor while confirmed login stays independently foregroundable', () => {
  const policy = section(
    layout,
    'struct StationheadSurfacePolicy {',
    'void ApplyStationheadChildLayout(',
  );
  assert.match(policy, /bool showPlayback = false;/);
  assert.match(
    policy,
    /selectedTab == StationheadTabKind::Stationhead && loginRequired/,
  );
  assert.match(
    policy,
    /!ResolveStationheadSurfacePolicy\(StationheadTabKind::Stationhead, true, false\)\.showPlayback/,
  );
  assert.match(
    policy,
    /ResolveStationheadSurfacePolicy\(StationheadTabKind::Stationhead, true, true\)\.showPlayback/,
  );

  const childLayout = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(layout, /StationheadMonitorPanelBounds\(const RECT& workspaceBounds\)[\s\S]*ComputeNativeDashboardLayout\(workspaceBounds\)\.media/);
  assert.match(childLayout, /const bool playbackForeground\s*=\s*[\s\S]*showPlayback \|\|/);
  assert.match(childLayout, /!showAuth && !hidePlayback && monitorForeground/);
  assert.match(childLayout, /const RECT playbackHostBounds =[\s\S]*monitorForeground && playbackForeground[\s\S]*StationheadMonitorPanelBounds\(workspaceBounds\)[\s\S]*: surfaceBounds;/);
  assert.match(childLayout, /const RECT authHostBounds = surfaceBounds;/);
  assert.match(childLayout, /const HWND hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM;/);
  assert.doesNotMatch(childLayout, /StationheadOffscreenBounds/);
  assert.match(childLayout, /controller->put_IsVisible\(TRUE\)/);
});

test('pending Stationhead authentication cannot be hidden by normal placement refreshes', () => {
  const selectTab = section(
    layout,
    'void StationheadPlayer::SelectTab(StationheadTabKind tab) {',
    'bool StationheadPlayer::HasAuthTab() const',
  );
  assert.match(
    selectTab,
    /tab == StationheadTabKind::None && loginRequired_ &&[\s\S]*!spotifyAuthorization_/,
  );
  assert.match(selectTab, /tab = StationheadTabKind::Stationhead;/);
  assert.doesNotMatch(
    selectTab,
    /if \(tab == StationheadTabKind::Stationhead\) \{\s*tab = StationheadTabKind::None;/,
  );
});

test('opening the dedicated Spotify auth surface releases the in-page interaction latch', () => {
  const selectTab = section(
    layout,
    'void StationheadPlayer::SelectTab(StationheadTabKind tab) {',
    'bool StationheadPlayer::HasAuthTab() const',
  );
  assert.match(
    selectTab,
    /if \(tab == StationheadTabKind::Auth && loginRequired_\) \{[\s\S]*loginRequired_ = false;[\s\S]*status_\.loginRequired = false;/,
  );
  assert.match(
    layout,
    /selectedTab_ == StationheadTabKind::Stationhead &&[\s\S]*return hostWindow_;/,
  );
});

test('auth probe promotes Connect music, Reconnect Music, or login surfaces to interactive mode', () => {
  assert.match(audioLoss, /return summary\('music-service-connect', evidence\);/);
  assert.match(
    audioLoss,
    /return summary\('music-service-reconnect', labelsOf\(reconnectSurface\)\);/,
  );
  const callback = section(
    audioLoss,
    'audioLossProbeComplete_ = !authentication;',
    '} catch (...) {',
  );
  const setRequiredAt = callback.indexOf('loginRequired_ = true;');
  const showAt = callback.indexOf('ShowForLogin();');
  const publishAt = callback.indexOf('status_.loginRequired = true;');
  assert.ok(setRequiredAt >= 0 && showAt > setRequiredAt && publishAt > showAt);
});

test('lightweight monitor probe also recognizes Reconnect Music', () => {
  const monitorProbe = section(
    audioLoss,
    'constexpr wchar_t kMonitorDomProbeScript[]',
    'constexpr wchar_t kAuthenticationUiProbeScript[]',
  );
  assert.match(monitorProbe, /\\breconnect\\s\+music\\b/);
});

test('real audio returns Stationhead behind the dashboard only after authentication clears', () => {
  const evaluate = section(
    audioLoss,
    'void StationheadPlayer::EvaluateAudioLossRecovery(int64_t nowMs) {',
    '}\n\n}  // namespace hp',
  );
  const audioBranch = section(
    evaluate,
    'if (audioPlaying) {',
    'const bool authenticationPending =',
  );

  assert.match(
    audioBranch,
    /selectedTab_ == StationheadTabKind::Stationhead &&[\s\S]*!spotifyAuthorization_ && !loginRequired_/,
  );
  assert.match(audioBranch, /SelectTab\(StationheadTabKind::None\);[\s\S]*PostChange\(\);/);
  assert.doesNotMatch(audioBranch, /loginRequired_ = false;/);
  assert.doesNotMatch(audioBranch, /status_\.loginRequired = false;/);
});

test('silent startup probes auth before any successful playback has occurred', () => {
  const evaluate = section(
    audioLoss,
    'void StationheadPlayer::EvaluateAudioLossRecovery(int64_t nowMs) {',
    '}\n\n}  // namespace hp',
  );
  const startupAt = evaluate.indexOf('if (!audioLossPlaybackObserved_) {');
  assert.ok(startupAt >= 0);
  const firstTimerAt = evaluate.indexOf('if (audioLossStartedAt_ == 0) {', startupAt);
  assert.ok(firstTimerAt > startupAt);
  const postStartupTimerAt = evaluate.indexOf(
    'if (audioLossStartedAt_ == 0) {',
    firstTimerAt + 1,
  );
  assert.ok(postStartupTimerAt > firstTimerAt);
  const startupBranch = evaluate.slice(startupAt, postStartupTimerAt);
  assert.match(startupBranch, /authenticationPending/);
  assert.match(startupBranch, /silentForMs < kStationheadAudioLossGraceMs/);
  assert.match(startupBranch, /audioLossProbeComplete_/);
  assert.match(startupBranch, /ResetAudioLossProbe\(\)/);
  assert.match(startupBranch, /BeginAudioLossAuthProbe\(nowMs\)/);
});
