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

test('unchanged startup preview bounds do not relayout WebView surfaces', () => {
  const setPreviewBounds = section(
    layoutSource,
    'void StationheadPlayer::SetStartupPreviewBounds(const RECT& bounds)',
    'void StationheadPlayer::ClearStartupPreviewBounds()',
  );
  assert.match(
    setPreviewBounds,
    /startupPreviewActive_ && EqualRect\(&bounds_, &bounds\)[\s\S]*return;/,
  );
});

test('duplicate hide notifications avoid repeated layout and focus churn', () => {
  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /!viewVisible_[\s\S]*selectedTab_ == StationheadTabKind::None[\s\S]*hostWindow_ && IsWindow\(hostWindow_\)[\s\S]*return;/,
  );
  assert.match(setVisible, /const bool hadInteractiveSurface/);
  assert.match(
    setVisible,
    /hadInteractiveSurface && !startupPreviewActive_[\s\S]*GetFocus\(\) != window_[\s\S]*SetFocus\(window_\)/,
  );
});

test('reselecting a ready active surface skips redundant Win32 and COM layout work', () => {
  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /if \(viewVisible_\)[\s\S]*StationheadTabKind::Stationhead[\s\S]*hostWindow_ && IsWindow\(hostWindow_\)[\s\S]*return;/,
  );
  assert.match(
    setVisible,
    /StationheadTabKind::Auth[\s\S]*authController_ && authWebview_[\s\S]*IsWindowVisible\(authHostWindow_\)[\s\S]*return;/,
  );
});

test('host resize is checked before synchronous WebView controller bounds reads', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  const playbackHostCheck = applyLayout.indexOf(
    'WindowClientSizeMatches(hostWindow, hostWidth, hostHeight)',
  );
  const playbackControllerCheck = applyLayout.indexOf(
    'ControllerBoundsMatch(controller, contentBounds)',
  );
  const authHostCheck = applyLayout.indexOf(
    'WindowClientSizeMatches(authHostWindow, width, height)',
  );
  const authControllerCheck = applyLayout.indexOf(
    'ControllerBoundsMatch(authController, authBounds)',
  );
  assert.ok(playbackHostCheck >= 0 && playbackHostCheck < playbackControllerCheck);
  assert.ok(authHostCheck >= 0 && authHostCheck < authControllerCheck);
});
