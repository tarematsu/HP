import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url),
  'utf8',
);

const lifecycle = readNative('renderer_lifecycle.cpp');
const playbackResolve = readNative('dashboard_playback_resolve.cpp');
const panelWindows = readNative('renderer_panels/windows.inc');

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('persisted playback snapshots cannot trigger fallback during dashboard startup', () => {
  assert.match(playbackResolve, /kPlaybackFallbackMaximumAgeMs\s*=\s*30'000/);
  const freshness = section(
    playbackResolve,
    'bool ProjectionFreshForFallback(',
    'bool PlaybackEndedWithoutNextTrack(',
  );
  assert.match(freshness, /projection\.stale/);
  assert.match(freshness, /projection\.fetchedAt\s*<=\s*0/);
  assert.match(freshness, /nowMs\s*-\s*projection\.fetchedAt\s*<=\s*kPlaybackFallbackMaximumAgeMs/);

  const ended = section(
    playbackResolve,
    'bool PlaybackEndedWithoutNextTrack(',
    '}  // namespace',
  );
  assert.ok(
    ended.indexOf('ProjectionFreshForFallback') < ended.indexOf('projection.ended'),
    'fallback freshness must be checked before an ended snapshot is accepted',
  );
});

test('dashboard initialization rolls back every partially started stage', () => {
  const initialize = section(
    lifecycle,
    'void Renderer::Initialize()',
    'void Renderer::Resize(',
  );
  assert.match(initialize, /if \(!EnsureNativeStaticWindows\(\)\)/);
  assert.match(initialize, /try \{/);
  assert.match(initialize, /catch \(\.\.\.\)/);
  assert.match(
    initialize,
    /catch \(\.\.\.\) \{\s*StopRadarCompose\(\);\s*StopNativePlaybackBridge\(\);\s*DestroyNativeStaticWindows\(\);\s*throw;/,
  );
});

test('native dashboard child callbacks do not leak C++ exceptions through user32', () => {
  const handler = section(
    panelWindows,
    'LRESULT Renderer::HandleNativeStaticMessage(',
    'void Renderer::PaintNativeSide(',
  );
  assert.match(handler, /try \{/);
  assert.match(handler, /catch \(\.\.\.\)/);
  assert.match(handler, /if \(message == WM_PAINT\) ValidateRect\(hwnd, nullptr\)/);
  assert.match(handler, /KillTimer\(hwnd, kNativePanelTickTimer\)/);
});
