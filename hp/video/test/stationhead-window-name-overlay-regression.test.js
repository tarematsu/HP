import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);

test('Stationhead profile windows keep their logical names', () => {
  for (const [profile, name] of [
    ['spotify-v2-1', 'tgut'],
    ['spotify-v2-2', 'yuukiar'],
    ['spotify-v2-3', 'ten'],
    ['spotify-v2-4', 'nagi'],
    ['spotify-v2-5', 'hinata'],
    ['spotify-v2-6', 'ozeki'],
  ]) {
    assert.match(
      layout,
      new RegExp(`profileName == L"${profile}"\\) return L"${name}"`),
    );
  }
});

test('Stationhead playback and auth hosts both receive a top-left native name overlay', () => {
  assert.match(layout, /kStationheadWindowNameOverlayLeft\s*=\s*8/);
  assert.match(layout, /kStationheadWindowNameOverlayTop\s*=\s*8/);
  assert.match(layout, /WM_NCHITTEST[\s\S]*HTTRANSPARENT/);
  assert.match(layout, /EnsureStationheadWindowNameOverlay\(hostWindow_, profileName_\)/);
  assert.match(layout, /EnsureStationheadWindowNameOverlay\(authHostWindow_, profileName_\)/);
});

test('name overlay is raised after WebView2 controller layout', () => {
  const start = layout.indexOf('void ApplyStationheadChildLayout(');
  const end = layout.indexOf(
    '}  // namespace\n\nbool StationheadPlayer::EnsureHostWindow()',
    start,
  );
  assert.ok(start >= 0);
  assert.ok(end > start);

  const childLayout = layout.slice(start, end);
  const controllerLayout = childLayout.indexOf('if (authController) {');
  const playbackRaise = childLayout.indexOf(
    'RaiseStationheadWindowNameOverlay(hostWindow_);',
  );
  const authRaise = childLayout.indexOf(
    'RaiseStationheadWindowNameOverlay(authHostWindow_);',
  );
  assert.ok(controllerLayout >= 0);
  assert.ok(playbackRaise > controllerLayout);
  assert.ok(authRaise > playbackRaise);
});
