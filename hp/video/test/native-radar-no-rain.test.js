import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const radarUi = readFileSync(
  new URL('../../native/src/renderer_radar_ui.cpp', import.meta.url),
  'utf8',
);
const mvPanel = readFileSync(
  new URL('../../native/src/renderer_panels/mv_section.inc', import.meta.url),
  'utf8',
);

test('native radar detects an entirely transparent forecast and stops animation', () => {
  assert.match(radarUi, /std::optional<RECT> RadarVisibleTileRect\(/);
  assert.match(radarUi, /bool BitmapHasVisiblePixels\(HBITMAP bitmap, const RECT& area\)/);
  assert.match(radarUi, /bool RadarTileLayoutCoversSource\(/);
  assert.match(
    radarUi,
    /std::optional<bool> RadarTileHasRain\(\s*const RadarTile& tile, int sourceWidth, int sourceHeight\)/s,
  );
  assert.match(
    radarUi,
    /bool RadarForecastHasNoRain\(\s*const std::vector<RadarTile>& tiles, int sourceWidth, int sourceHeight\)/s,
  );
  assert.match(
    radarUi,
    /noRainForecast = !precomposed && forecastComplete &&\s*RadarForecastHasNoRain\(forecastTiles, sourceWidth, sourceHeight\);/s,
  );
  assert.match(radarUi, /if \(noRainForecast\) animationIntervalMs = 0;/);
  assert.match(radarUi, /L"\|no-rain:" << \(noRainForecast \? 1 : 0\)/);
  assert.match(radarUi, /noRainForecast \? kNoRainMessage : RadarTimeFromMillis\(validAt\)/);
});

test('clear forecast detection ignores off-panel pixels and rejects incomplete tile layouts', () => {
  assert.match(
    radarUi,
    /RadarVisibleTileRect\(tile, sourceWidth, sourceHeight\)/,
  );
  assert.match(
    radarUi,
    /BitmapHasVisiblePixels\(bitmap, \*visible\)/,
  );
  assert.match(
    radarUi,
    /if \(!frameDestinations\.emplace\(destination\.x, destination\.y\)\.second\) \{\s*forecastComplete = false;/s,
  );
  assert.match(
    radarUi,
    /if \(!RadarTileLayoutCoversSource\(\s*frameDestinations, sourceWidth, sourceHeight\)\) \{\s*forecastComplete = false;/s,
  );
  assert.match(radarUi, /native-radar-v12/);
  assert.doesNotMatch(radarUi, /bool BitmapHasVisiblePixels\(HBITMAP bitmap\) \{/);
});

test('native radar renders in the former MV slot and keeps the clear forecast message', () => {
  assert.match(
    mvPanel,
    /const bool noRain = hasFrame && timeText == L"しばらく雨は降りません";/,
  );
  assert.match(
    mvPanel,
    /else if \(noRain\) \{[\s\S]*TierFont\(FontTier::Large\)[\s\S]*L"しばらく雨は降りません"/,
  );
  assert.match(
    mvPanel,
    /const std::wstring chipText = noRain\s*\? L"雨雲レーダー"/s,
  );
  assert.match(mvPanel, /StretchRadarInto\(dc, bounds, radarFrameBitmap_\)/);
  assert.match(radarUi, /InvalidatePanelSection\(nativeMainWindow_, PanelSection::Music\)/);
});