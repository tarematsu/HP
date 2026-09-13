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

test('hidden dashboard defers air graph projection and window invalidation', () => {
  assert.match(
    panelState,
    /void Renderer::UpdateAirHistory[\s\S]*if \(!nativeDashboardVisible_\) \{\s*nativeAirGraph_ = \{\};\s*return;\s*\}[\s\S]*const int64_t nowMs = UnixMillis\(\);[\s\S]*RebuildNativeAirGraph\(nowMs\);[\s\S]*EnsureNativeStaticWindows\(\)/,
  );
  assert.doesNotMatch(panelState, /airGraphExpired|airCutoff/);
  assert.match(lifecycle, /if \(visible\) \{[\s\S]*RebuildNativeAirGraph\(UnixMillis\(\)\);[\s\S]*StartRadarCompose\(\)/);
  assert.match(lifecycle, /ResetNativeBitmapCaches\(\);[\s\S]*nativeAirGraph_ = \{\};/);
});
