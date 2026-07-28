import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url),
  'utf8',
);
const panelState = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);
const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('hidden dashboard defers air graph projection and window invalidation', () => {
  assert.match(
    panelState,
    /if \(nativeDashboardVisible_\) \{[\s\S]*RebuildNativeAirGraph\(UnixMillis\(\)\);[\s\S]*\} else \{[\s\S]*nativeAirGraph_ = \{\};/,
  );
  assert.match(panelState, /if \(!nativeDashboardVisible_\) return;[\s\S]*EnsureNativeStaticWindows\(\)/);
  assert.match(lifecycle, /if \(visible\) \{[\s\S]*RebuildNativeAirGraph\(UnixMillis\(\)\);[\s\S]*StartRadarCompose\(\)/);
  assert.match(lifecycle, /ResetNativeBitmapCaches\(\);[\s\S]*nativeAirGraph_ = \{\};/);
});

test('playback progress-only repaint avoids copying track strings', () => {
  const start = mediaSection.indexOf('const bool progressClipOnly');
  const end = mediaSection.indexOf('const NativePlaybackRender sharedPlayback');
  assert.ok(start >= 0 && end > start, 'progress-only branch is missing');
  const progressBranch = mediaSection.slice(start, end);
  assert.match(progressBranch, /std::lock_guard lock\(nativePlaybackMutex_\)/);
  assert.match(progressBranch, /const NativePlaybackProjection& projection/);
  assert.match(progressBranch, /progressDurationMs/);
  assert.match(progressBranch, /drawProgress\(progressMs, progressDurationMs, progressPlaying\)/);
  assert.doesNotMatch(progressBranch, /ResolveNativePlayback\(/);
  assert.doesNotMatch(progressBranch, /NativePlaybackTrack/);
});
