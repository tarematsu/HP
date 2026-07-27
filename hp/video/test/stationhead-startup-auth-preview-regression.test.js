import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handleHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const appMessages = readFileSync(
  new URL('../../native/src/app_messages.cpp', import.meta.url),
  'utf8',
);
const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

function assertOrdered(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const at = source.indexOf(marker);
    assert.ok(at >= 0, `missing marker: ${marker}`);
    assert.ok(at > previous, `out-of-order marker: ${marker}`);
    previous = at;
  }
}

test('pending Spotify auth intentionally has no playback or preview surface', () => {
  const policy = section(
    layoutSource,
    'constexpr StationheadSurfacePolicy ResolveStationheadSurfacePolicy(',
    'static_assert(ResolveStationheadSurfacePolicy(',
  );

  assert.match(policy, /authSelected && !authSurfaceReady/);
  assert.match(
    policy,
    /startupPreviewActive && !showAuth && !hidePlaybackForPendingAuth/,
  );
});

test('active Spotify auth takes precedence over audible playback at startup', () => {
  const readiness = section(
    handleHeader,
    'inline bool StationheadStartupPreviewReady(',
    'static_assert(SecondaryStationheadStartupReady',
  );

  assertOrdered(readiness, [
    'if (status.spotifyAuthorization)',
    'if (status.audioPlaying || status.loginRequired)',
    'status.detail == L"station loaded"',
  ]);
  assert.doesNotMatch(readiness, /status\.audioPlaying \|\| status\.loginRequired \|\|/);
});

test('Window B remains covered until the Spotify auth document is usable', () => {
  const readiness = section(
    handleHeader,
    'inline bool StationheadStartupPreviewReady(',
    'static_assert(SecondaryStationheadStartupReady',
  );

  assert.match(readiness, /if \(status\.spotifyAuthorization\) \{/);
  assert.match(
    readiness,
    /return !status\.navigating && status\.detail == L"Spotify login ready";/,
  );
  assert.doesNotMatch(readiness, /\|\|\s*status\.spotifyAuthorization/);
});

test('a loaded playback document cannot bypass an active pending auth surface', () => {
  const readiness = section(
    handleHeader,
    'inline bool StationheadStartupPreviewReady(',
    'static_assert(SecondaryStationheadStartupReady',
  );

  const authBranchAt = readiness.indexOf('if (status.spotifyAuthorization)');
  const audioAt = readiness.indexOf('if (status.audioPlaying || status.loginRequired)');
  const stationFallbackAt = readiness.indexOf('status.detail == L"station loaded"');
  assert.ok(authBranchAt >= 0 && audioAt > authBranchAt);
  assert.ok(stationFallbackAt > audioAt);
});

test('the auth navigation callback publishes readiness before exposing B', () => {
  const authConfigure = section(
    webviewSource,
    'void StationheadPlayer::ConfigureAuthWebView()',
    'void StationheadPlayer::CloseWebView()',
  );

  assertOrdered(authConfigure, [
    'status_.detail = L"Spotify login ready";',
    'SelectTab(StationheadTabKind::Auth);',
    'PostChange();',
  ]);
});

test('Window B latches completed Auth readiness across later playback updates', () => {
  const secondary = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  const apply = section(
    secondary,
    'void ApplyDeferredStartupPreview() {',
    'RECT pendingStartupPreviewBounds_',
  );

  assert.match(secondary, /bool startupAuthReadyObserved_ = false;/);
  assert.match(apply, /const StationheadStatus status = RawStatus\(\);/);
  assertOrdered(apply, [
    'if (!status.spotifyAuthorization)',
    'status.navigating || !status.authAvailable',
    '!status.navigating && status.authAvailable',
    'status.detail == L"Spotify login ready"',
    'startupAuthReadyObserved_ = true;',
    'if (status.spotifyAuthorization && startupAuthReadyObserved_)',
    'StationheadStatus authReadyStatus = status;',
    'authReadyStatus.detail = L"Spotify login ready";',
    'StationheadStartupPreviewReady(authReadyStatus)',
    'StationheadStartupPreviewReady(status)',
  ]);
});

test('Window B clears a previous Auth-ready latch for a replacement session', () => {
  const secondary = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  const apply = section(
    secondary,
    'void ApplyDeferredStartupPreview() {',
    'RECT pendingStartupPreviewBounds_',
  );

  assert.match(
    apply,
    /if \(status\.navigating \|\| !status\.authAvailable\) \{[\s\S]*startupAuthReadyObserved_ = false;/,
  );
  assert.match(
    apply,
    /if \(!status\.navigating && status\.authAvailable &&[\s\S]*status\.detail == L"Spotify login ready"\)/,
  );
  assert.ok(
    apply.indexOf('status.navigating || !status.authAvailable') <
      apply.indexOf('if (status.spotifyAuthorization && startupAuthReadyObserved_)'),
  );
});

test('Window B re-evaluates deferred preview on the posted state-change event', () => {
  const secondary = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  const consume = section(
    secondary,
    'uint32_t ConsumeChangeFlags() {',
    'StationheadStatus Status() const',
  );

  assertOrdered(consume, [
    'StationheadHandleBase::ConsumeChangeFlags()',
    'ApplyDeferredStartupPreview();',
    'return flags;',
  ]);
  assert.match(
    appMessages,
    /secondaryStationhead_\s*\? secondaryStationhead_->ConsumeChangeFlags\(\)/,
  );
});

test('popup authorization becomes active before its controller is created', () => {
  const newWindow = section(
    webviewSource,
    'const HRESULT newWindowResult = webview_->add_NewWindowRequested(',
    'if (FAILED(newWindowResult))',
  );

  assertOrdered(newWindow, [
    'spotifyAuthorization_ = true;',
    'SelectTab(StationheadTabKind::Auth);',
    'CreateProfileController(authHostWindow_, onController.Get())',
  ]);
  assert.doesNotMatch(
    newWindow.slice(0, newWindow.indexOf('const auto onController')),
    /Spotify login ready/,
  );
});
