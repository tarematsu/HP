import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
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
  const authBranch = section(
    applyLayout,
    '  if (showAuth) {',
    '    return;\n  }',
  );

  assertOrdered(authBranch, [
    'authController->put_IsVisible(TRUE);',
    'SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING',
    'ShowWindow(hostWindow, SW_HIDE)',
    'controller->put_IsVisible(FALSE);',
  ]);
});

test('playback surface is complete before auth is retired', () => {
  const authBranchEnd = applyLayout.indexOf('    return;\n  }');
  assert.notEqual(authBranchEnd, -1);
  const playbackBranch = applyLayout.slice(authBranchEnd + '    return;\n  }'.length);

  assertOrdered(playbackBranch, [
    'controller->put_IsVisible(TRUE);',
    'SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING',
    'ShowWindow(authHostWindow, SW_HIDE)',
    'authController->put_IsVisible(FALSE);',
  ]);
});

test('hidden destination hosts are sized without exposing an empty frame', () => {
  assert.match(
    applyLayout,
    /if \(!showAuth && hostValid &&[\s\S]*SetWindowPos\(hostWindow, hostPlacement,[\s\S]*SWP_NOACTIVATE \| SWP_NOSENDCHANGING\);/,
  );
  assert.match(
    applyLayout,
    /if \(showAuth && authHostValid &&[\s\S]*SetWindowPos\(authHostWindow, HWND_TOP,[\s\S]*SWP_NOACTIVATE \| SWP_NOSENDCHANGING\);/,
  );
});

test('focus follows the selected WebView2 surface after visual handoff', () => {
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
    /PlaybackSurfaceMatches\([\s\S]*HiddenAuthSurfaceMatches\([\s\S]*WindowContainsFocus\(hostWindow_\)[\s\S]*return;/,
  );
  assert.match(
    setVisible,
    /ActiveAuthSurfaceMatches\([\s\S]*WindowContainsFocus\(authHostWindow_\)[\s\S]*return;/,
  );

  const focusCommit = setVisible.slice(setVisible.lastIndexOf('  viewVisible_ = true;'));
  assertOrdered(focusCommit, [
    'LayoutControllers();',
    'ApplyMute();',
    'if (selectedTab_ == StationheadTabKind::Auth)',
    'activeController->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);',
  ]);
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

test('pending auth creation never raises the collapsed playback host', () => {
  const activeHost = section(
    layoutSource,
    'HWND StationheadPlayer::ActiveHostWindowForAccountSetup() const noexcept',
    'bool StationheadPlayer::NeedsInteractiveWindow() const',
  );
  assert.match(
    activeHost,
    /if \(selectedTab_ == StationheadTabKind::Auth\)[\s\S]*return authHostWindow_;[\s\S]*return nullptr;[\s\S]*return hostWindow_;/,
  );
});
