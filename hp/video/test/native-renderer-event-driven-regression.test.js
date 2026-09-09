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
  assert.match(state, /stationheadPlayHistory/);
  assert.doesNotMatch(state, /SensorSnapshot|airHistory|appVersion|toast|newsIndex/);
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
    /case WM_HP_SWITCHBOT_UPDATED:[\s\S]*?return 0;\s*\}/,
  )?.[0] ?? '';
  assert.match(switchBotCase, /renderer_->UpdateSensors\(sensors_->Snapshot\(\)\)/);
  assert.doesNotMatch(switchBotCase, /renderState_|PublishRenderState/);
});

test('air history owns its vector and pushes only history changes to renderer', () => {
  assert.match(airHistory, /auto& history = airHistory_/);
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

test('Stationhead compatibility publication remains available', () => {
  assert.match(appHeader, /RenderState renderState_/);
  assert.match(appHeader, /void PublishRenderState\(\)/);
  assert.match(appHeader, /void PublishRenderStateNow\(\)/);
  assert.match(rendererHeader, /void UpdateState\(const RenderState& state\)/);
  assert.match(rendererLifecycle, /void Renderer::UpdateState\(const RenderState& state\)/);
  assert.match(panelState, /void Renderer::UpdateNativeStaticPanels\(const RenderState& state\)/);
  assert.match(appSource, /#if 0\s+\/\/ Stationhead disabled:/);
});
