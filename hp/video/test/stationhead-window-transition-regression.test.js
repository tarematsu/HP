import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

const applyLayout = section(
  layoutSource,
  'void ApplyStationheadChildLayout(',
  '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
);

function assertOrdered(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const at = source.indexOf(marker);
    assert.ok(at >= 0, `missing marker: ${marker}`);
    assert.ok(at > previous, `out-of-order marker: ${marker}`);
    previous = at;
  }
}

test('auth surface is complete before playback is retired', () => {
  assertOrdered(applyLayout, [
    'if (showAuth) {',
    'authController->put_IsVisible(TRUE);',
    'SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING',
    'if (hostWasVisible) ShowWindow(hostWindow, SW_HIDE);',
    'controller->put_IsVisible(FALSE);',
    'return;',
  ]);
});

test('background playback is restored before the auth surface is retired', () => {
  const normalPlaybackAt = applyLayout.lastIndexOf('  if (controller) {');
  assert.notEqual(normalPlaybackAt, -1);
  const normalPlayback = applyLayout.slice(normalPlaybackAt);
  assertOrdered(normalPlayback, [
    'controller->put_IsVisible(TRUE);',
    'SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING',
    'ShowWindow(authHostWindow, SW_HIDE);',
    'authController->put_IsVisible(FALSE);',
  ]);
});

test('hidden destination hosts are sized without exposing an empty frame', () => {
  assert.match(
    applyLayout,
    /if \(!hidePlayback && hostValid &&[\s\S]*SetWindowPos\(hostWindow, HWND_BOTTOM,[\s\S]*SWP_NOACTIVATE \| SWP_NOSENDCHANGING\);/,
  );
  assert.match(
    applyLayout,
    /if \(showAuth && authHostValid &&[\s\S]*SetWindowPos\(authHostWindow, HWND_TOP,[\s\S]*SWP_NOACTIVATE \| SWP_NOSENDCHANGING\);/,
  );
});

test('only the explicit Spotify authorization surface receives WebView2 focus', () => {
  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    layoutSource,
    /bool WindowContainsFocus\(HWND window\) noexcept[\s\S]*focused == window \|\| IsChild\(window, focused\)/,
  );
  assert.match(
    setVisible,
    /ActiveAuthSurfaceMatches\([\s\S]*WindowContainsFocus\(authHostWindow_\)[\s\S]*return;/,
  );
  assert.match(
    setVisible,
    /LayoutControllers\(\);[\s\S]*ApplyMute\(\);[\s\S]*authController_->MoveFocus\(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC\);/,
  );
  assert.doesNotMatch(setVisible, /controller_->MoveFocus/);
});

test('hiding Stationhead only returns focus when an interactive surface owned it', () => {
  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /const bool interactiveSurfaceHadFocus =[\s\S]*WindowContainsFocus\(hostWindow_\)[\s\S]*WindowContainsFocus\(authHostWindow_\)/,
  );
  assert.match(
    setVisible,
    /hadInteractiveSurface && interactiveSurfaceHadFocus &&[\s\S]*SetFocus\(window_\)/,
  );
});

test('pending auth creation never exposes the collapsed playback host as an account surface', () => {
  const activeHost = section(
    layoutSource,
    'HWND StationheadPlayer::ActiveHostWindowForAccountSetup() const noexcept',
    'bool StationheadPlayer::NeedsInteractiveWindow() const',
  );
  assert.match(
    activeHost,
    /if \(selectedTab_ == StationheadTabKind::Auth\)[\s\S]*return authHostWindow_;[\s\S]*return nullptr;[\s\S]*return nullptr;/,
  );
  assert.doesNotMatch(activeHost, /return hostWindow_;/);
});

test('reapplying unchanged bounds still repairs playback z-order and size', () => {
  const playerSetBounds = section(
    layoutSource,
    'void StationheadPlayer::SetBounds(const RECT& bounds)',
    'void StationheadPlayer::SelectTab(',
  );
  assert.match(
    playerSetBounds,
    /if \(!EqualRect\(&bounds_, &resolved\)\) bounds_ = resolved;/,
  );
  assert.match(playerSetBounds, /LayoutControllers\(\);/);
  assert.doesNotMatch(playerSetBounds, /EqualRect\(&bounds_, &resolved\)\) return;/);

  const handleSetBounds = section(
    handleSource,
    'void StationheadHandleBase::SetBounds(const RECT& bounds)',
    'void StationheadHandleBase::SetStartupPreviewBounds(',
  );
  assert.match(
    handleSetBounds,
    /if \(!EqualRect\(&workspaceBounds_, &bounds\)\) workspaceBounds_ = bounds;/,
  );
  assert.match(handleSetBounds, /ApplyBounds\(\);/);
  assert.doesNotMatch(handleSetBounds, /EqualRect\(&workspaceBounds_, &bounds\)\) return;/);
});
