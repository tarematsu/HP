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

test('App owns six Stationhead players and defers their staggered start', () => {
  const start = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  const deferred = section(app, 'void App::StartDeferredServices(', 'void App::StopServices()');
  assert.match(appHeader, /kStationheadPeerCount = 5/);
  assert.match(appHeader, /std::array<AppStationheadHandle, kStationheadPeerCount> stationheadPeers_/);
  assert.match(start, /std::make_unique<StationheadPlayer>\(\s*window_, config_\.stationhead,/);
  assert.match(start, /ReuseWebViewProfile\(kStationheadPeerProfiles\[i\]\)/);
  assert.match(start, /ReuseWebViewProfile\(kStationheadOzekiProfile\)/);
  assert.doesNotMatch(start, /stationhead_->Start\(\)/);
  assert.match(deferred, /stationheadPeers_\[i\]->Start\(\)/);
  assert.match(deferred, /stationhead_->Start\(\)/);
  assert.doesNotMatch(stationheadHeader, /enum class StationheadRole/);
  assert.doesNotMatch(appHeader, /AppSecondaryStationheadHandle/);
  assert.doesNotMatch(handles, /PeerAudioHandle|StartupPrimaryHandle/);
});

test('Stationhead fleet shares the handoff message and placement path', () => {
  assert.match(messages, /case WM_HP_PRIMARY_RELOAD_READY:[\s\S]*return stationhead_ \? 1 : 0/);
  const placement = section(app, 'void App::ApplyStationheadWindowPlacement(', 'void App::ScheduleNextTick(');
  assert.match(placement, /stationheadPeers_\[i\]->SetBounds\(bounds\)/);
  assert.match(placement, /stationhead_->SetBounds\(bounds\)/);
  assert.doesNotMatch(placement, /RECT left|RECT right/);
  assert.doesNotMatch(app, /PublishRenderState/);
  assert.doesNotMatch(appHeader, /renderState_|renderStateDirty_|PublishRenderState/);
});

test('all Stationhead windows reuse the shared WebView2 environment and existing profiles', () => {
  assert.match(sharedEnvironment, /Acquire\(userDataFolder, true, true, std::move\(completion\)\)/);
  assert.match(app, /kStationheadPeerProfiles\{[\s\S]*spotify-v2-1[\s\S]*spotify-v2-5/);
  assert.match(app, /kStationheadOzekiProfile\[\] = L"spotify-v2-6"/);
  assert.match(stationheadHeader, /void ReuseWebViewProfile\(std::wstring profileName\)/);
});
