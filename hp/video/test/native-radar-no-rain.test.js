import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const radarUi = readFileSync(
  new URL('../../native/src/renderer_radar_ui.cpp', import.meta.url),
  'utf8',
);
const panelWindows = readFileSync(
  new URL('../../native/src/renderer_panels/windows.inc', import.meta.url),
  'utf8',
);

test('native radar detects an entirely transparent forecast and stops animation', () => {
  assert.match(radarUi, /bool BitmapHasVisiblePixels\(HBITMAP bitmap\)/);
  assert.match(radarUi, /std::optional<bool> RadarTileHasRain\(const RadarTile& tile\)/);
  assert.match(radarUi, /bool RadarForecastHasNoRain\(const std::vector<RadarTile>& tiles\)/);
  assert.match(
    radarUi,
    /noRainForecast = !precomposed && forecastComplete &&\s*RadarForecastHasNoRain\(forecastTiles\);/s,
  );
  assert.match(radarUi, /if \(noRainForecast\) animationIntervalMs = 0;/);
  assert.match(radarUi, /L"\|no-rain:" << \(noRainForecast \? 1 : 0\)/);
  assert.match(radarUi, /noRainForecast \? kNoRainMessage : RadarTimeFromMillis\(validAt\)/);
});

test('native radar panel renders the clear forecast message prominently', () => {
  assert.match(
    panelWindows,
    /const bool noRain = hasFrame && timeText == L"しばらく雨は降りません";/,
  );
  assert.match(
    panelWindows,
    /else if \(noRain\) \{[\s\S]*TierFont\(FontTier::Large\)[\s\S]*L"しばらく雨は降りません"/,
  );
  assert.match(
    panelWindows,
    /const std::wstring chipText = noRain\s*\? L"雨雲レーダー"/s,
  );
});
