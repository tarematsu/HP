import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const finalPolicySource = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
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

test('hide evaluates the resulting surface before returning focus to Main', () => {
  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );

  assertOrdered(setVisible, [
    'const bool interactiveSurfaceHadFocus =',
    'if (controller_) KeepPlaybackBehindDashboard();',
    'SetFocus(window_);',
  ]);
  assert.equal(
    layoutSource.split('SetFocus(').length - 1,
    1,
    'the final PCH focus policy must remain scoped to the Stationhead hide path',
  );
});

test('focus preservation resolves the direct Stationhead host after WebView child focus', () => {
  const detector = section(
    finalPolicySource,
    'inline bool StationheadFocusRemainsInteractive(',
    'inline HWND SetFocusAfterStationheadHide(',
  );

  assert.match(detector, /HWND surface = focused;/);
  assert.match(detector, /HWND parent = GetParent\(surface\);/);
  assert.match(
    detector,
    /while \(parent && parent != target\) \{[\s\S]*surface = parent;[\s\S]*parent = GetParent\(surface\);[\s\S]*\}/,
  );
  assert.match(detector, /parent != target \|\| !IsWindowVisible\(surface\)/);
});

test('a full-size visible auth or login surface keeps keyboard focus', () => {
  const detector = section(
    finalPolicySource,
    'inline bool StationheadFocusRemainsInteractive(',
    'inline HWND SetFocusAfterStationheadHide(',
  );
  const wrapper = section(
    finalPolicySource,
    'inline HWND SetFocusAfterStationheadHide(',
    '\n}\n\n}  // namespace hp',
  );

  assert.match(detector, /GetClientRect\(surface, &client\)/);
  assert.match(
    detector,
    /StationheadFocusSurfaceIsInteractive\([\s\S]*client\.right - client\.left,[\s\S]*client\.bottom - client\.top\)/,
  );
  assert.match(wrapper, /const HWND focused = GetFocus\(\);/);
  assert.match(
    wrapper,
    /if \(StationheadFocusRemainsInteractive\(target, focused\)\) return focused;/,
  );
});

test('the visible 1x1 playback host is not treated as interactive', () => {
  const sizePolicy = section(
    finalPolicySource,
    'inline constexpr bool StationheadFocusSurfaceIsInteractive(',
    'inline bool StationheadFocusRemainsInteractive(',
  );

  assert.match(sizePolicy, /return width > 1 && height > 1;/);
  assert.match(sizePolicy, /static_assert\(!StationheadFocusSurfaceIsInteractive\(1, 1\)\);/);
  assert.match(sizePolicy, /static_assert\(!StationheadFocusSurfaceIsInteractive\(1, 720\)\);/);
  assert.match(sizePolicy, /static_assert\(!StationheadFocusSurfaceIsInteractive\(1280, 1\)\);/);
  assert.match(sizePolicy, /static_assert\(StationheadFocusSurfaceIsInteractive\(2, 2\)\);/);
});

test('collapsed, hidden or invalid Stationhead focus is restored to the parent', () => {
  const wrapper = section(
    finalPolicySource,
    'inline HWND SetFocusAfterStationheadHide(',
    '\n}\n\n}  // namespace hp',
  );

  assertOrdered(wrapper, [
    'StationheadFocusRemainsInteractive(target, focused)',
    'return focused;',
    'return ::SetFocus(target);',
  ]);
  assert.match(
    finalPolicySource,
    /#define SetFocus\(target\) \(::hp::SetFocusAfterStationheadHide\(\(target\)\)\)/,
  );
});
