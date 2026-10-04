import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url),
  'utf8',
);

const memory = read('native_memory_pressure.h');
const app = read('app.cpp');
const appHeader = read('app.h');
const collector = read('stationhead_leaderboard_collector.cpp');
const collectorHeader = read('stationhead_leaderboard_collector.h');

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('native memory guard uses system pressure with hysteresis', () => {
  assert.match(memory, /GlobalMemoryStatusEx/);
  assert.match(memory, /kEnterAvailableBytes = 512ULL \* kMiB/);
  assert.match(memory, /kExitAvailableBytes = 768ULL \* kMiB/);
  assert.match(memory, /kEnterMemoryLoad = 88/);
  assert.match(memory, /kExitMemoryLoad = 82/);
  assert.match(memory, /currentlyActive/);
});

test('only HomePanel descendant WebView2 processes receive low memory priority', () => {
  assert.match(memory, /CreateToolhelp32Snapshot\(TH32CS_SNAPPROCESS/);
  assert.match(memory, /GetCurrentProcessId\(\)/);
  assert.match(memory, /msedgewebview2\.exe/);
  assert.match(memory, /belongsToCurrentProcess/);
  assert.match(memory, /SetProcessInformation\(/);
  assert.match(memory, /ProcessMemoryPriority/);
  assert.match(memory, /MEMORY_PRIORITY_LOW/);
  assert.match(memory, /MEMORY_PRIORITY_NORMAL/);
  assert.doesNotMatch(memory, /EmptyWorkingSet|SetProcessWorkingSetSize|TerminateProcess/);
});

test('app rechecks pressure without adding a polling thread', () => {
  assert.match(appHeader, /nextMemoryPressureCheckAt_/);
  assert.match(appHeader, /memoryPressureActive_/);
  assert.match(app, /kMemoryPressureCheckMs = 15'000/);
  const tick = section(app, 'void App::Tick()', 'void App::UpdateMemoryPressure(');
  assert.match(tick, /UpdateMemoryPressure\(now\)/);
  assert.match(tick, /NextDelayFromDeadline\(now, nextMemoryPressureCheckAt_/);
  assert.doesNotMatch(tick, /std::thread|setInterval/);
});

test('pressure lowers WebView memory priority and restores it after recovery', () => {
  const update = section(app, 'void App::UpdateMemoryPressure(', 'void App::Draw()');
  assert.match(update, /NativeMemoryPressureShouldBeActive/);
  assert.match(update, /ApplyNativeWebViewMemoryPriority\(active\)/);
  assert.match(update, /SetMemoryPressure\(active, now\)/);
  assert.match(update, /Native memory pressure/);
  assert.match(update, /available=/);
  assert.match(update, /webview_processes=/);
  assert.match(app, /ApplyNativeWebViewMemoryPriority\(false\)/);
});

test('memory pressure never tears down existing Stationhead playback windows', () => {
  const deferred = section(app, 'void App::StartDeferredServices(', 'void App::StopServices()');
  assert.match(deferred, /memoryPressureActive_[\s\S]*continue/);
  assert.match(deferred, /lastStationheadLaunchAt_ \+ kMediaStartupStageDelayMs/);
  assert.doesNotMatch(deferred, /stationheadPeers_\[i\]->Stop\(\)|stationhead_->Stop\(\)/);
  const pressure = section(app, 'void App::UpdateMemoryPressure(', 'void App::Draw()');
  assert.doesNotMatch(pressure, /TrySuspend|CloseController|Stop\(\)/);
});

test('transient leaderboard WebView is aborted and postponed under pressure', () => {
  assert.match(collectorHeader, /SetMemoryPressure\(bool active, int64_t nowMs\)/);
  assert.match(collectorHeader, /bool memoryPressure_/);
  assert.match(collector, /kMemoryPressureRetryMs = 5 \* 60'000/);
  const setter = section(
    collector,
    'void StationheadLeaderboardCollector::SetMemoryPressure(',
    'void StationheadLeaderboardCollector::Tick(',
  );
  assert.match(setter, /\+\+generation_/);
  assert.match(setter, /CloseController\(\)/);
  assert.match(setter, /environment_\.Reset\(\)/);
  assert.match(setter, /memory_pressure_suspended/);
  assert.match(collector, /BeginCapture\(int64_t nowMs\)[\s\S]*memoryPressure_/);
});
