import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const cmake = readFileSync(new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');
const app = source('app.cpp');
const appHeader = source('app.h');
const handles = source('app_stationhead_handles.h');
const messages = source('app_messages.cpp');
const sharedEnvironment = source('shared_webview_environment.h');
const stationheadHeader = source('sh.h');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('Stationhead build contains only active sources', () => {
  for (const source of ['sh.cpp', 'sh_webview.cpp', 'sh_layout.cpp', 'sh_audio.cpp',
    'sh_audio_loss.cpp']) {
    assert.match(cmake, new RegExp(`src/${source.replaceAll('.', '\\.')}`));
  }
  assert.doesNotMatch(cmake,
    /app_stationhead_(?:state|history)|stationhead_(?:disabled_stubs|native_stats)|sh_profile_reuse_policy_(?:begin|end)/);
});

test('App owns exactly one Stationhead handle and creates one primary player', () => {
  const start = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  assert.match(start, /StationheadRole::Primary/);
  assert.match(start, /ReuseWebViewProfile\(kStationheadAmazonProfile\)/);
  assert.match(start, /stationhead_->Start\(\)/);
  assert.doesNotMatch(start, /#if 0|Secondary|secondaryStationhead_/);
  assert.doesNotMatch(appHeader, /AppSecondaryStationheadHandle|secondaryStationhead_/);
  assert.doesNotMatch(handles, /AppSecondaryStationheadHandle|PeerAudioHandle|StartupPrimaryHandle/);
});

test('single Stationhead has no A-B handoff or dormant render-state path', () => {
  assert.match(messages, /case WM_HP_PRIMARY_RELOAD_READY:[\s\S]*return stationhead_ \? 1 : 0/);
  assert.doesNotMatch(messages, /WM_HP_SECONDARY_RELOAD_READY/);
  const placement = section(app, 'void App::ApplyStationheadWindowPlacement(', 'void App::ScheduleNextTick(');
  assert.match(placement, /stationhead_->SetBounds\(bounds\)/);
  assert.doesNotMatch(placement, /secondary|RECT left|RECT right/);
  assert.doesNotMatch(app, /PublishRenderState/);
  assert.doesNotMatch(appHeader, /renderState_|renderStateDirty_|PublishRenderState/);
});

test('Stationhead reuses the existing full-resource profile', () => {
  assert.match(sharedEnvironment, /Acquire\(userDataFolder, false, false, std::move\(completion\)\)/);
  assert.match(app, /kStationheadAmazonProfile\[\] = L"spotify-v2-1"/);
  assert.match(stationheadHeader, /void ReuseWebViewProfile\(std::wstring profileName\)/);
});
