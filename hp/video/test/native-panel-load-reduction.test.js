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
  assert.match(parser, /previous->switchBotDevices/);
  assert.match(parser, /Compatibility fallback for old cached dashboard files/);
  assert.doesNotMatch(parser, /SectionRevision\(/);
  assert.match(dashboardHeader, /uint64_t octopus = 0;/);
  assert.match(dashboardHeader, /uint64_t switchbot = 0;/);
  assert.doesNotMatch(dashboardHeader, /uint64_t energy = 0;/);
  assert.match(dashboardLoader, /ParseDashboardSnapshot\(text, snapshot, nullptr, previous\)/);
});

test('air sensor values and history graph invalidate independently', () => {
  assert.match(rendererHeader, /AirStats,/);
  assert.match(rendererHeader, /AirGraph,/);
  assert.match(
    panelState,
    /if \(sensorsChanged\) \{\s*InvalidatePanelSection\(nativeSideWindow_, PanelSection::AirStats\);/s,
  );
  assert.match(
    panelState,
    /if \(historyChanged\) \{\s*InvalidatePanelSection\(nativeSideWindow_, PanelSection::AirGraph\);/s,
  );
  assert.match(environment, /GetClipBox\(dc, &clip\)/);
  assert.match(environment, /if \(!drawGraph\) return;/);
  assert.match(panelWindows, /RearrangedAirStatsRectFromCard\(sections\.controls\)/);
  assert.match(panelWindows, /RearrangedAirGraphRectFromCard\(sections\.controls\)/);
});

test('Octopus chart cache is independent from SwitchBot live watts', () => {
  assert.match(rendererHeader, /EnergySwitchBot/);
  assert.match(rendererHeader, /DrawEnergySwitchBotSection/);
  assert.match(dashboardLoader, /\+\+dashboardRevisions_\.octopus/);
  assert.match(dashboardLoader, /\+\+dashboardRevisions_\.switchbot/);
  assert.match(
    panelState,
    /else if \(switchbotChanged\) \{\s*InvalidatePanelSection\(nativeMainWindow_, PanelSection::EnergySwitchBot\);/s,
  );
  assert.match(panelWindows, /dashboardRevisions_\.octopus, &Renderer::DrawEnergySection/);
  assert.match(panelWindows, /DrawEnergySwitchBotSection\(scope\.dc, sections\.air\)/);
  assert.match(energy, /void Renderer::DrawEnergySwitchBotSection/);
  assert.match(layout, /RECT EnergySwitchBotRectFromCard/);
});

test('clock paint consumes cached network-clock strings', () => {
  assert.doesNotMatch(layout, /NetworkClockJstNow\(&hpNow\)/);
  assert.match(layout, /nativeClockDateText_/);
  assert.match(layout, /nativeClockTimeText_/);
  assert.match(panelState, /const bool clockReady = NetworkClockJstNow\(&localTime\)/);
  assert.match(panelState, /nativeClockDateText_ = ClockDateText\(localTime\)/);
  assert.match(panelState, /nativeClockTimeText_ = ClockTimeText\(localTime\)/);
});
