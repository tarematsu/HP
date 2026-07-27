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
