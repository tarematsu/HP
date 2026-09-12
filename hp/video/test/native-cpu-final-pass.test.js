import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const panelState = source('renderer_panel_state.cpp');

test('Spotify identity adoption uses one immediate check plus one coalesced fallback', () => {
  assert.match(runtime, /const checkTarget = media =>/);
  assert.match(runtime, /const status = checkTarget\(media\)/);
  assert.match(runtime, /identityFallbackTimer = setTimeout\([\s\S]*1500\)/);
  assert.match(runtime, /clearIdentityFallback\(\)/);
  assert.doesNotMatch(runtime, /\[0,\s*250,\s*1000,\s*2500,\s*5000\]/);
  assert.doesNotMatch(runtime, /forEach\(delay =>/);
});

test('SwitchBot cache is refreshed by sensor/update events instead of the one-second clock timer', () => {
  const updateStart = panelState.indexOf('void Renderer::UpdateSensors');
  const airStart = panelState.indexOf('void Renderer::UpdateAirHistory', updateStart);
  const updateSensors = panelState.slice(updateStart, airStart);
  const tickStart = panelState.indexOf('void Renderer::TickNativePanels');
  const tick = panelState.slice(tickStart);

  assert.match(updateSensors, /LoadSwitchBot\(dataDir_ \/ L"switchbot\.json"\)/);
  assert.doesNotMatch(panelState, /kSwitchBotPanelProbeMs/);
  assert.doesNotMatch(panelState, /nextSwitchBotProbeAt/);
  assert.doesNotMatch(tick, /LoadSwitchBot/);
});
