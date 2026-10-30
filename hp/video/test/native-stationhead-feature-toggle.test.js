import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const app = read('app.cpp');
const header = read('app.h');
const config = read('config.cpp');
const overlay = read('power_saving_overlay.inc');
const schedule = read('power_saving_schedule.inc');
const routing = read('power_saving_window_routing.inc');
const messages = read('app_messages.cpp');

const section = (source, start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing section: ${start}`);
  return source.slice(a, b);
};

test('new Stationhead switch occupies the right side of monitor in four-button footer', () => {
  assert.match(overlay, /kControlButtonCount = 4/);
  assert.match(overlay, /LocalPowerButtonRect\(\)[\s\S]*ControlButtonRect\(row, 1\)/);
  assert.match(overlay, /LocalStationheadButtonRect\(\)[\s\S]*?ControlButtonRect\(row, 3\)/);
  assert.match(overlay, /LocalMuteButtonRect\(\)[\s\S]*?ControlButtonRect\(row, 2\)/);
  assert.match(overlay, /UiAction::StationheadFeatureToggle/);
  assert.match(overlay, /L"SH ON"/);
  assert.match(overlay, /L"SH OFF"/);
});

test('toggle is committed atomically outside updater-managed files before changing runtime', () => {
  assert.match(config, /bool LoadStationheadEnabled\(const fs::path& path\)/);
  assert.match(config, /if \(!input\) return true/);
  assert.match(config, /bool SaveStationheadEnabled\(const fs::path& path, bool enabled\)/);
  assert.match(config, /MOVEFILE_REPLACE_EXISTING \| MOVEFILE_WRITE_THROUGH/);
  assert.match(app, /stationheadEnabled_ = LoadStationheadEnabled\(dataDir_ \/ L"stationhead-enabled.txt"\)/);
  const handler = section(app, 'case UiAction::StationheadFeatureToggle:', 'case UiAction::StationheadAudioToggle:');
  assert.match(handler, /if \(!SaveStationheadEnabled\([\s\S]*\)\) \{/);
  assert.ok(handler.indexOf('SaveStationheadEnabled') < handler.indexOf('stationheadEnabled_ = enabled'));
  assert.match(app, /PowerSavingController::SetStationheadFeatureEnabled\(stationheadEnabled_\)/);
});

test('OFF stops all six playback windows but leaves the independent leaderboard collector running', () => {
  const stop = section(app, 'void App::StopStationheadServices()', 'void App::StopServices()');
  assert.doesNotMatch(stop, /stationheadLeaderboardCollector_->Stop\(\)/);
  assert.doesNotMatch(stop, /stationheadLeaderboardCollector_\.reset\(\)/);
  assert.match(stop, /stationheadPeers_\[i\]->Stop\(\)/);
  assert.match(stop, /stationhead_->Stop\(\)/);
  assert.match(stop, /for \(auto& peer : stationheadPeers_\) peer\.reset\(\)/);
  assert.match(stop, /stationhead_\.reset\(\)/);
  const startup = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  assert.match(startup, /stationheadLeaderboardCollector_ =/);
  const deferredCollector = section(app, 'void App::StartDeferredServices(', 'void App::StopStationheadServices()');
  assert.match(deferredCollector, /stationheadLeaderboardCollector_->Start\(now\)/);
  assert.ok(deferredCollector.indexOf('stationheadLeaderboardCollector_->Start(now)') < deferredCollector.indexOf('if (stationheadEnabled_)'));
  const shutdown = section(app, 'void App::StopServices()', 'void App::Tick()');
  assert.match(shutdown, /stationheadLeaderboardCollector_->Stop\(\)/);
  assert.match(shutdown, /stationheadLeaderboardCollector_\.reset\(\)/);
  const startup = section(app, 'void App::StartDeferredServices(', 'void App::StopStationheadServices()');
  assert.match(startup, /if \(stationheadEnabled_\) \{/);
  assert.match(header, /int64_t stationheadStartupAt_ = 0/);
  const tick = section(app, 'void App::Tick()', 'void App::Draw()');
  assert.match(tick, /if \(stationheadEnabled_\) \{[\s\S]*stationheadStartupAt_ \+ kMediaStartupStageDelayMs/);
  assert.match(messages, /case WM_HP_STATIONHEAD_CHANGED:[\s\S]*if \(!stationheadEnabled_\) return 0/);
});

test('OFF suppresses Stationhead monitor probes and restricts audio to YT or mute', () => {
  assert.match(schedule, /if \(!stationheadEnabled_ \|\| monitorMode_ == MonitorMode::Off \|\| powerSaving_\) return/);
  assert.match(schedule, /if \(stationheadEnabled_ && monitorMode_ != MonitorMode::Off\) \{/);
  assert.match(schedule, /void PowerSavingController::CycleAudioMode\(\) noexcept \{\s*if \(!stationheadEnabled_\)/);
  assert.match(schedule, /void PowerSavingController::CycleMonitorMode\(\) noexcept \{\s*if \(!stationheadEnabled_\)/);
  assert.match(routing, /if \(!stationheadEnabled_ \|\| monitorMode_ == MonitorMode::Off\) break/);
  assert.match(routing, /stationheadEnabled_ && monitorMode_ == MonitorMode::ServiceGrid/);
});
