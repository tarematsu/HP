import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const renderState = readFileSync(
  new URL('../../native/src/render_state.h', import.meta.url),
  'utf8',
);
const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const appMessages = readFileSync(
  new URL('../../native/src/app_messages.cpp', import.meta.url),
  'utf8',
);
const rendererHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
  'utf8',
);
const rendererLifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url),
  'utf8',
);
const panelState = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);
const airHistory = readFileSync(
  new URL('../../native/src/app_air_history.cpp', import.meta.url),
  'utf8',
);

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} is missing`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`${signature} has no closing brace`);
}

test('active native panel state is not duplicated in RenderState', () => {
  const state = renderState.match(/struct RenderState \{([\s\S]*?)\n\};/)?.[1] ?? '';
  assert.match(state, /StationheadStatus stationhead/);
  assert.doesNotMatch(state, /stationheadPlayHistory|SensorSnapshot|airHistory|appVersion|toast|newsIndex/);
  assert.match(appHeader, /std::vector<AirHistorySample> airHistory_/);
  assert.match(appHeader, /std::wstring toastText_/);
});

test('sensor notifications update renderer directly without aggregate publication', () => {
  const sensorCase = appMessages.match(
    /case WM_HP_SENSOR_UPDATED:[\s\S]*?return 0;\s*\}/,
  )?.[0] ?? '';
  assert.match(sensorCase, /renderer_->UpdateSensors\(snapshot\)/);
  assert.match(sensorCase, /UpdateAirHistory\(snapshot\)/);
  assert.doesNotMatch(sensorCase, /renderState_|PublishRenderState/);

  const switchBotCase = appMessages.match(
    /case WM_HP_SWITCHBOT_UPDATED:[\s\S]*?return 0;/,
  )?.[0] ?? '';
  assert.match(switchBotCase, /renderer_->LoadSwitchBot\(dataDir_ \/ L"switchbot\.json"\)/);
  assert.doesNotMatch(switchBotCase, /UpdateSensors|sensors_->Snapshot|renderState_|PublishRenderState/);
});

test('air history owns its vector and pushes only history changes to renderer', () => {
  assert.match(airHistory, /airHistory_\.insert\(position, sample\)/);
  assert.match(airHistory, /renderer_->UpdateAirHistory\(airHistory_\)/);
  assert.doesNotMatch(airHistory, /renderState_\.airHistory|airHistoryRevision|MarkRenderStateDirty/);
});

test('normal app tick and paint do not publish aggregate renderer state', () => {
  const tick = functionBody(appSource, 'void App::Tick()');
  const draw = functionBody(appSource, 'void App::Draw()');
  const activeTick = tick.replace(/#if 0[\s\S]*?#endif/g, '');
  assert.doesNotMatch(activeTick, /PublishRenderState/);
  assert.doesNotMatch(draw, /PublishRenderState/);
  assert.match(draw, /renderer_->Render\(\)/);
});

test('News rotation compatibility state is completely removed', () => {
  assert.doesNotMatch(appHeader, /newsIndex_|newsCount_|lastNewsRotateAt_/);
  assert.doesNotMatch(appSource, /NewsCount\(|newsIndex_|newsCount_|lastNewsRotateAt_/);
  assert.doesNotMatch(appMessages, /NewsCount\(|newsIndex_|newsCount_|lastNewsRotateAt_/);
  assert.doesNotMatch(rendererHeader, /NewsCount\(/);
});

test('App no longer owns dormant Stationhead compatibility publication', () => {
  assert.doesNotMatch(appHeader, /RenderState renderState_|PublishRenderState|renderStateDirty_/);
  assert.doesNotMatch(appSource, /PublishRenderState|renderer_->UpdateState\(renderState_\)/);
  assert.match(rendererHeader, /void UpdateState\(const RenderState& state\)/);
  assert.match(rendererLifecycle, /void Renderer::UpdateState\(const RenderState& state\)/);
  assert.match(panelState, /void Renderer::UpdateNativeStaticPanels\(const RenderState& state\)/);
  assert.doesNotMatch(panelState, /stationheadPlayHistory|GlobalStationheadNativeStatsStore/);
  assert.match(appSource, /std::make_unique<StationheadPlayer>\(\s*window_, config_\.stationhead,/);
  assert.match(appSource, /stationhead_->Start\(\)/);
  assert.match(appSource, /Spotify #1 launch issued at \+10 seconds; #2 and #3 follow at 10-second offsets/);
  assert.match(appSource, /Stationhead launch issued at \+40 seconds/);
});
