import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const panelState = source('renderer_panel_state.cpp');
const lifecycle = source('renderer_lifecycle.cpp');
const appMessages = source('app_messages.cpp');

test('Spotify identity adoption is event driven without renderer fallback timers', () => {
  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(runtime, /const scheduleTargetChecks = media => enforceTarget\(media\)/);
  assert.doesNotMatch(runtime, /identityFallbackTimer|setTimeout\(/);
  assert.match(events, /addEventListener\('playing', observe, true\)/);
  assert.match(events, /addEventListener\('loadedmetadata', observe, true\)/);
  assert.match(events, /addEventListener\('canplay', observe, true\)/);
  assert.match(events, /addEventListener\('timeupdate', observe, true\)/);
});

test('SwitchBot cache uses startup and update events instead of the one-second clock timer', () => {
  const tickStart = panelState.indexOf('void Renderer::TickNativePanels');
  const tick = panelState.slice(tickStart);

  assert.match(lifecycle, /LoadSwitchBot\(dataDir_ \/ L"switchbot\.json"\)/);
  assert.match(appMessages, /case WM_HP_SWITCHBOT_UPDATED:[\s\S]*renderer_->LoadSwitchBot/);
  assert.doesNotMatch(panelState, /kSwitchBotPanelProbeMs|nextSwitchBotProbeAt|LoadSwitchBot/);
  assert.doesNotMatch(tick, /LoadSwitchBot/);
});