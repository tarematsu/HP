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

test('hidden dashboard suspends air invalidation without a projection cache', () => {
  assert.match(
    panelState,
    /void Renderer::UpdateAirHistory[\s\S]*nativeAirHistory_ = history;[\s\S]*if \(!nativeDashboardVisible_ \|\| !EnsureNativeStaticWindows\(\)\) return;[\s\S]*PanelSection::AirGraph/,
  );
  assert.match(lifecycle, /KillTimer\(nativeMainWindow_, kNativePanelTickTimer\)/);
  assert.doesNotMatch(panelState, /nativeAirGraph_|RebuildNativeAirGraph/);
  assert.doesNotMatch(lifecycle, /nativeAirGraph_|RebuildNativeAirGraph/);
});
