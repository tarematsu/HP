import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const parser = readFileSync(
  new URL('../../native/src/dashboard_data.cpp', import.meta.url),
  'utf8',
);
const dashboardHeader = readFileSync(
  new URL('../../native/src/dashboard_data.h', import.meta.url),
  'utf8',
);
const dashboardLoader = readFileSync(
  new URL('../../native/src/renderer_dashboard.cpp', import.meta.url),
  'utf8',
);
const rendererHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
  'utf8',
);
const panelState = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);
const panelWindows = readFileSync(
  new URL('../../native/src/renderer_panels/windows.inc', import.meta.url),
  'utf8',
);
const bitmapCache = readFileSync(
  new URL('../../native/src/renderer_bitmap_cache.cpp', import.meta.url),
  'utf8',
);
const environment = readFileSync(
  new URL('../../native/src/renderer_panels/environment_sections.inc', import.meta.url),
  'utf8',
);
const energy = readFileSync(
  new URL('../../native/src/renderer_panels/data_sections.inc', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../../native/src/renderer_panels/layout_overrides.inc', import.meta.url),
  'utf8',
);

test('dashboard sections use source versions and reuse unchanged materialized data', () => {
  assert.match(parser, /json::Number\(object, L"__version", -1\)/);
  assert.match(parser, /previous->weatherHours/);
  assert.match(parser, /previous->octopusProfile/);
  assert.match(parser, /previous->octopusRender/);
  assert.match(parser, /previous->switchBotDevices/);
  assert.match(parser, /BuildOctopusRenderProjection\(next\)/);
  assert.match(parser, /bool ParseSwitchBotDevices/);
  assert.match(parser, /Compatibility fallback for old cached dashboard files/);
  assert.doesNotMatch(parser, /SectionRevision\(/);
  assert.match(dashboardHeader, /uint64_t octopus = 0;/);
  assert.match(dashboardHeader, /uint64_t switchbot = 0;/);
  assert.match(dashboardHeader, /struct OctopusRenderProjection/);
  assert.doesNotMatch(dashboardHeader, /uint64_t energy = 0;/);
  assert.match(dashboardLoader, /ParseDashboardSnapshot\(text, snapshot, nullptr, previous\)/);
});

test('air sensor values and five-minute history update renderer independently', () => {
  assert.match(rendererHeader, /void UpdateSensors\(const SensorSnapshot& sensors\);/);
  assert.match(rendererHeader, /void UpdateAirHistory\(const std::vector<AirHistorySample>& history\);/);
  assert.match(
    panelState,
    /void Renderer::UpdateSensors[\s\S]*PanelSection::AirStats/s,
  );
  assert.match(
    panelState,
    /void Renderer::UpdateAirHistory[\s\S]*RebuildNativeAirGraph\(UnixMillis\(\)\)[\s\S]*PanelSection::AirGraph/s,
  );
  assert.doesNotMatch(panelState, /airGraphExpired|airCutoff/);
  assert.match(environment, /GetClipBox\(dc, &clip\)/);
  assert.match(environment, /if \(!drawGraph\) return;/);
  assert.match(panelWindows, /RearrangedAirStatsRectFromCard\(sections\.controls\)/);
  assert.match(panelWindows, /RearrangedAirGraphRectFromCard\(sections\.controls\)/);
});

test('Octopus and SwitchBot own independent invalidation paths', () => {
  assert.match(
    dashboardLoader,
    /if \(weatherChanged\) \{\s*InvalidatePanelSection\(nativeSideWindow_, PanelSection::Weather\);/s,
  );
  assert.match(
    dashboardLoader,
    /if \(octopusChanged\) \{\s*InvalidatePanelSection\(nativeMainWindow_, PanelSection::Energy\);/s,
  );
  assert.match(dashboardLoader, /bool Renderer::LoadSwitchBot/);
  assert.match(dashboardLoader, /ParseSwitchBotDevices\(text, devices, nullptr\)/);
  assert.match(
    dashboardLoader,
    /previousRows == nextRows \? PanelSection::EnergySwitchBot : PanelSection::Energy/s,
  );
  assert.match(panelState, /LoadSwitchBot\(dataDir_ \/ L"switchbot\.json"\)/);
  assert.doesNotMatch(rendererHeader, /renderedDashboardRevisions_|dashboardRevisions_/);
});

test('SwitchBot-only paint skips Octopus chart execution', () => {
  assert.match(rendererHeader, /EnergySwitchBot/);
  assert.match(rendererHeader, /DrawEnergySwitchBotSection/);
  assert.match(panelWindows, /const bool switchBotOnly =/);
  assert.match(panelWindows, /if \(!switchBotOnly\) DrawEnergySection/);
  assert.match(panelWindows, /DrawEnergySwitchBotSection\(scope\.dc, sections\.energy\)/);
  assert.match(energy, /void Renderer::DrawEnergySwitchBotSection/);
  assert.match(layout, /RECT EnergySwitchBotRectFromCard/);
});

test('energy card uses a revision and size keyed bitmap while panel back buffers remain dirty-region based', () => {
  assert.match(rendererHeader, /struct EnergyBitmapCache/);
  assert.match(rendererHeader, /EnergyBitmapCache energyBitmapCache_/);
  assert.match(energy, /void Renderer::DrawEnergySectionUncached/);
  assert.match(energy, /energyBitmapCache_\.octopusRevision != revision/);
  assert.match(energy, /BitBlt\(dc, card\.left, card\.top, width, height/);
  assert.match(bitmapCache, /if \(energyBitmapCache_\.bitmap\) DeleteObject\(energyBitmapCache_\.bitmap\)/);
  assert.match(bitmapCache, /energyBitmapCache_ = \{\};/);
  assert.doesNotMatch(rendererHeader, /PanelBitmapCache|nativeSectionBitmaps_|DrawCachedPanelSection/);
  assert.match(rendererHeader, /std::map<HWND, PanelBackBuffer> nativeBackBuffers_/);
  assert.match(panelWindows, /IntersectClipRect\(dc, dirty\.left, dirty\.top, dirty\.right, dirty\.bottom\)/);
});

test('Octopus chart aggregation and GDI pen allocation happen only during cache rebuild', () => {
  assert.match(parser, /projection\.currentWeekUsage \+= item\.currentTotal/);
  assert.match(parser, /projection\.previousWeekUsage \+= item\.previousTotal/);
  assert.match(parser, /projection\.maximum = std::max/);
  assert.match(energy, /nativeDashboard_\.octopusRender\.maximum/);
  assert.match(energy, /HPEN dottedPen = CreatePen/);
  assert.equal((energy.match(/CreatePen\(PS_DOT/g) ?? []).length, 1);
  assert.equal((energy.match(/DeleteObject\(dottedPen\)/g) ?? []).length, 1);
});

test('clock paint consumes cached network-clock strings', () => {
  assert.doesNotMatch(layout, /NetworkClockJstNow\(&hpNow\)/);
  assert.match(layout, /nativeClockDateText_/);
  assert.match(layout, /nativeClockTimeText_/);
  assert.match(panelState, /const bool clockReady = NetworkClockJstNow\(&localTime\)/);
  assert.match(panelState, /nativeClockDateText_ = ClockDateText\(localTime\)/);
  assert.match(panelState, /nativeClockTimeText_ = ClockTimeText\(localTime\)/);
});
