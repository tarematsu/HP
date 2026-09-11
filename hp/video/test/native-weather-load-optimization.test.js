import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rendererDashboard = readFileSync(
  new URL('../../native/src/renderer_dashboard.cpp', import.meta.url),
  'utf8',
);
const rendererHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
  'utf8',
);
const bitmapCache = readFileSync(
  new URL('../../native/src/renderer_bitmap_cache.cpp', import.meta.url),
  'utf8',
);
const environmentSections = readFileSync(
  new URL('../../native/src/renderer_panels/environment_sections.inc', import.meta.url),
  'utf8',
);
const snapshot = readFileSync(
  new URL('../../cloud/src/snapshot.ts', import.meta.url),
  'utf8',
);
const cadenceMigration = readFileSync(
  new URL('../../cloud/migrations/202607220100_resource_budget_3000.sql', import.meta.url),
  'utf8',
);

test('weather refresh remains hourly instead of increasing cloud fetch load', () => {
  assert.match(cadenceMigration, /WHEN 'weather' THEN 3600/);
});

test('unchanged weather payloads keep the same source revision', () => {
  assert.match(snapshot, /delete copy\.generatedAt;/);
  assert.match(snapshot, /WHEN current_state\.content_hash IS NOT excluded\.content_hash THEN current_state\.version\+1/);
  assert.match(snapshot, /WHERE current_state\.content_hash IS NOT excluded\.content_hash/);
});

test('native dashboard invalidates weather only when its source revision changes', () => {
  assert.match(
    rendererDashboard,
    /const bool weatherChanged = firstSnapshot \|\|[\s\S]*snapshot\.revisions\.weather != nativeDashboard_\.revisions\.weather;/,
  );
  assert.match(
    rendererDashboard,
    /if \(weatherChanged\) \{[\s\S]*InvalidatePanelSection\(nativeSideWindow_, PanelSection::Weather\);/,
  );
});

test('weather panel reuses a completed bitmap for unchanged revisions', () => {
  assert.match(rendererHeader, /struct WeatherPanelCache/);
  assert.match(bitmapCache, /bool Renderer::DrawCachedWeatherPanel/);
  assert.match(bitmapCache, /weatherPanelCache_\.revision != nativeDashboard_\.revisions\.weather/);
  assert.match(environmentSections, /if \(DrawCachedWeatherPanel\(dc, card\)\) return;/);
  assert.match(environmentSections, /CaptureWeatherPanel\(dc, card\);/);
});

test('weather icons use a dedicated bitmap cache', () => {
  assert.match(rendererHeader, /nativeWeatherIconBitmaps_/);
  assert.match(rendererHeader, /nativeWeatherIconUseCounter_/);
  assert.match(bitmapCache, /auto found = nativeWeatherIconBitmaps_\.find\(key\);/);
  assert.match(bitmapCache, /CacheNativeWeatherIconBitmap\(key, bitmap\)/);
  assert.match(bitmapCache, /deleteBitmaps\(nativeWeatherIconBitmaps_\);/);
});
