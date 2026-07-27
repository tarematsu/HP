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

test('a still-visible auth or login surface keeps keyboard focus', () => {
  const wrapper = section(
    finalPolicySource,
    'inline HWND SetFocusAfterStationheadHide(',
    '\n}\n\n}  // namespace hp',
  );

  assert.match(wrapper, /const HWND focused = GetFocus\(\);/);
  assert.match(
    wrapper,
    /focused && focused != target && IsWindow\(focused\) &&[\s\S]*IsWindowVisible\(focused\)/,
  );
  assertOrdered(wrapper, [
    'IsWindowVisible(focused)',
    'return focused;',
    'return ::SetFocus(target);',
  ]);
});

test('hidden or invalid Stationhead focus is restored to the parent window', () => {
  assert.match(
    finalPolicySource,
    /#define SetFocus\(target\) \(::hp::SetFocusAfterStationheadHide\(\(target\)\)\)/,
  );
  assert.match(
    finalPolicySource,
    /current focus is gone, invalid, or belongs to a surface that is actually hidden/,
  );
});
