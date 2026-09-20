import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../../native/src/app.cpp', import.meta.url), 'utf8');
const appHeader = readFileSync(new URL('../../native/src/app.h', import.meta.url), 'utf8');
const handles = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url), 'utf8');
const player = readFileSync(new URL('../../native/src/sh.h', import.meta.url), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

function ordered(text, markers) {
  let previous = -1;
  for (const marker of markers) {
    const at = text.indexOf(marker);
    assert.ok(at > previous, `missing/out-of-order marker: ${marker}`);
    previous = at;
  }
}

test('dashboard and YouTube initialize before the top-level window is exposed', () => {
  const start = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  ordered(start, [
    'renderer_->Initialize();',
    'rendererStarted_ = true;',
    'LayoutWorkspace();',
    'renderer_->TickNativePanels(startupAt_);',
    'ShowWindow(window_, startupShowCommand_);',
  ]);
  assert.doesNotMatch(start, /stationhead_->Start\(\)|stationheadPeers_\[i\]->Start\(\)|StartSpotify\(\)/);
});

test('Stationhead fleet workspace keeps the dashboard visible', () => {
  const layout = section(app, 'void App::LayoutWorkspace()',
    'void App::ApplyStationheadWindowPlacement(');
  assert.match(layout, /selectedTab_ = WorkspaceTab::Main;/);
  assert.match(layout, /renderer_->SetVisible\(rendererStarted_\);/);
});

test('cold startup prepares six Stationhead players and defers every start', () => {
  const start = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  const deferred = section(app, 'void App::StartDeferredServices(', 'void App::StopServices()');
  assert.match(appHeader, /kStationheadPeerCount = 5/);
  assert.match(start, /std::make_unique<StationheadPlayer>\(\s*window_, config_\.stationhead,/);
  assert.match(start, /ReuseWebViewProfile\(kStationheadPeerProfiles\[i\]\)/);
  assert.match(start, /ReuseWebViewProfile\(kStationheadOzekiProfile\)/);
  assert.doesNotMatch(start, /stationhead_->Start\(\)|stationheadPeers_\[i\]->Start\(\)/);
  assert.match(deferred, /stationheadPeers_\[i\]->Start\(\)/);
  assert.match(deferred, /stationhead_->Start\(\)/);
  assert.doesNotMatch(player, /enum class StationheadRole/);
  assert.doesNotMatch(handles, /PeerAudioHandle|StartupPrimaryHandle/);
});
