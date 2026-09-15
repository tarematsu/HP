import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const panelState = source('renderer_panel_state.cpp');
const lifecycle = source('renderer_lifecycle.cpp');
const appMessages = source('app_messages.cpp');

test('Spotify identity adoption uses one immediate check plus one coalesced fallback', () => {
  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(runtime, /const status = enforceTarget\(media\)/);
  assert.match(runtime, /identityFallbackTimer = setTimeout\([\s\S]*1500\)/);
  assert.match(runtime, /clearIdentityFallback\(\)/);
  assert.doesNotMatch(runtime, /\[0,\s*250,\s*1000,\s*2500,\s*5000\]/);
  assert.doesNotMatch(runtime, /forEach\(delay =>/);
});

test('SwitchBot cache uses startup and update events instead of the one-second clock timer', () => {
  const tickStart = panelState.indexOf('void Renderer::TickNativePanels');
  const tick = panelState.slice(tickStart);

  assert.match(lifecycle, /LoadSwitchBot\(dataDir_ \/ L"switchbot\.json"\)/);
  assert.match(appMessages, /case WM_HP_SWITCHBOT_UPDATED:[\s\S]*renderer_->LoadSwitchBot/);
  assert.doesNotMatch(panelState, /kSwitchBotPanelProbeMs|nextSwitchBotProbeAt|LoadSwitchBot/);
  assert.doesNotMatch(tick, /LoadSwitchBot/);
});