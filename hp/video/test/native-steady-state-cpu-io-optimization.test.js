import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
  'utf8',
);

const rendererHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
  'utf8',
);
const nativeMediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);
const stationheadPlayerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const stationheadHandles = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);
const airHistory = readFileSync(
  new URL('../../native/src/app_air_history.cpp', import.meta.url),
  'utf8',
);
const sensorSerial = readFileSync(
  new URL('../../native/src/sensors_serial.cpp', import.meta.url),
  'utf8',
);
const artworkCache = readFileSync(
  new URL('../../native/src/artwork_cache.h', import.meta.url),
  'utf8',
);

test('App timer follows real deadlines instead of a fixed five second dashboard cadence', () => {
  assert.doesNotMatch(appSource, /kSteadyDashboardTickMs/);
  assert.match(appSource, /stationhead_->NextWakeAt\(\)/);
  assert.doesNotMatch(appSource, /renderer_->NativePlaybackNextWakeAt\(now\)/);
  assert.match(appSource, /constexpr uint32_t kMaxAppTimerMs = 24U \* 60U \* 60U \* 1000U;/);
  assert.match(appSource, /NextDelayFromDeadline\(int64_t now, int64_t deadline, uint32_t fallbackMs\)/);
  assert.doesNotMatch(appSource, /constexpr uint32_t kMaxIdleTickMs/);
  assert.doesNotMatch(appSource, /selectedTab_ == WorkspaceTab::Main[\s\S]*kSteadyDashboardTickMs/);
});

test('healthy hidden Stationhead profiles skip costly maintenance during another profile\'s recovery ticks', () => {
  assert.match(stationheadHandles, /player_->AudioPlaying\(\) && !player_->SurfaceVisible\(\)/);
  assert.match(stationheadHandles, /nowMs < player_->NextWakeAt\(\)/);
  assert.match(stationheadHandles, /player_->EvaluateAudioLossRecovery\(nowMs\);\s*return;/);
});

test('steady Stationhead ticks read only the authorization flag', () => {
  assert.match(stationheadPlayerHeader, /bool SpotifyAuthorizationActive\(\) const/);
  assert.match(stationheadHandles, /player_->SpotifyAuthorizationActive\(\)/);
  assert.doesNotMatch(stationheadHandles, /player_->Status\(\)\.spotifyAuthorization/);
});

test('only active air history flushes dirty data on normal shutdown', () => {
  assert.match(appHeader, /struct HistoryFlushGuard/);
  assert.match(appHeader, /bool SaveAirHistory\(\) const;/);
  assert.doesNotMatch(appHeader, /SaveStationheadPlayHistory|stationheadPlayHistoryDirty_/);
  assert.match(appHeader, /bool airHistoryDirty_ = false;/);
  assert.match(
    airHistory,
    /HistoryFlushGuard::~HistoryFlushGuard\(\)[\s\S]*airHistoryDirty_[\s\S]*SaveAirHistory\(\)/,
  );
  assert.doesNotMatch(airHistory, /StationheadPlayHistory|stationheadPlayHistory/);
  assert.match(airHistory, /bool App::SaveAirHistory\(\) const/);
  assert.match(airHistory, /airHistoryDirty_ = true;/);
});

test('missing serial sensors use bounded exponential retry backoff', () => {
  assert.match(sensorSerial, /kSerialRetryInitial = std::chrono::seconds\(10\)/);
  assert.match(sensorSerial, /kSerialRetryMaximum = std::chrono::seconds\(60\)/);
  assert.match(sensorSerial, /retryDelay = std::min\(retryDelay \* 2, kSerialRetryMaximum\)/);
  assert.match(sensorSerial, /if \(changed\) PostMessageW\(window_, WM_HP_SENSOR_UPDATED/);
  assert.doesNotMatch(sensorSerial, /wait_for\(lock, std::chrono::seconds\(10\)/);
});

test('UD-CO2S sampling and renderer publication have a one-minute minimum interval', () => {
  assert.match(sensorSerial, /kSensorReadInterval = std::chrono::minutes\(1\)/);
  assert.match(
    sensorSerial,
    /sampleReceived = true;[\s\S]*sampleAcceptedAt = std::chrono::steady_clock::now\(\);[\s\S]*PostMessageW\(window_, WM_HP_SENSOR_UPDATED, 0, 0\);[\s\S]*break;/,
  );
  assert.match(
    sensorSerial,
    /RunSensorCommand\(serial, buffer, "STP"[\s\S]*sampleAcceptedAt \+ kSensorReadInterval[\s\S]*stopWake_\.wait_until\(lock, nextReadAt[\s\S]*RunSensorCommand\(serial, buffer, "STA"/,
  );
});

test('UD-CO2S stream is stopped on every serial exit path', () => {
  assert.match(sensorSerial, /if \(result == LineResult::Stopped\) return false;/);
  assert.match(
    sensorSerial,
    /Always issue a best-effort stop before closing[\s\S]*WriteCommand\(serial, "STP"\);[\s\S]*CloseHandle\(serial\);/,
  );
  assert.doesNotMatch(sensorSerial, /if \(measurementActive\) WriteCommand\(serial, "STP"\)/);
});

test('unused artwork pipeline performs no steady-state memory, disk, or network work', () => {
  assert.match(artworkCache, /inline std::wstring CacheArtworkUrl/);
  assert.match(artworkCache, /return \{\};/);
  assert.doesNotMatch(
    artworkCache,
    /MemoryIndex|WinHttpDownload|NetworkRequestCoordinator|spotify-artwork-cache/,
  );
});

test('Stationhead preview avoids deep status snapshots before audio is present', () => {
  const begin = stationheadHandles.indexOf('void SyncStationheadBackgroundPreview(');
  const end = stationheadHandles.indexOf('static_assert(', begin);
  assert.ok(begin >= 0 && end > begin);
  const body = stationheadHandles.slice(begin, end);
  assert.match(body, /if \(!StationheadBackgroundPreview\(\) \|\| !player\.AudioPlaying\(\)\) return;/);
  assert.ok(body.indexOf('if (!StationheadBackgroundPreview() || !player.AudioPlaying()) return;') <
    body.indexOf('const auto state = player.ReadSchedulerState();'));
  assert.match(body, /!state\.navigating && !state\.loginRequired/);
  assert.match(body, /!state\.spotifyAuthorization/);
  assert.doesNotMatch(body, /StationheadStatus|player\.Status\(\)/);
  assert.match(body, /SetStationheadBackgroundPreview\(false\)/);
});

test('Stationhead retry map only allocates entries for armed recovery windows', () => {
  const begin = stationheadHandles.indexOf('void StationheadHandleBase::Tick(');
  const end = stationheadHandles.indexOf('void StationheadHandleBase::ShowAfterAudioStop(', begin);
  assert.ok(begin >= 0 && end > begin);
  const tick = stationheadHandles.slice(begin, end);
  assert.match(tick, /auto found = boundaryRetries\.find\(this\);/);
  assert.match(tick, /\(found == boundaryRetries\.end\(\) \|\| !found->second\.armed\) &&\s*!player_->AudioPlaying\(\)/);
  assert.match(tick, /const bool active = player_->RetryPendingTrackBoundaryRefresh\(nowMs\);/);
  assert.match(tick, /if \(active\) \{\s*ArmBoundaryRetryState\(this, nowMs\);/);
  assert.match(tick, /if \(player_->ReadSchedulerState\(\)\.navigating\) ClearBoundaryRetryState\(this\);/);
  assert.match(tick, /found = boundaryRetries\.find\(this\);/);
  assert.match(tick, /if \(found == boundaryRetries\.end\(\) \|\| !found->second\.armed\) return;/);
  assert.doesNotMatch(tick, /BoundaryRetryStateFor\(this\)|boundaryRetries\[this\]/);
  assert.doesNotMatch(tick, /player_->Status\(\)/,
    'retry supervision should not copy playback details or URLs');
  const allocator = stationheadHandles.slice(
    stationheadHandles.indexOf('TrackBoundaryRetryState& BoundaryRetryStateFor('),
    stationheadHandles.indexOf('bool RequiresInteractiveStationhead('),
  );
  assert.match(allocator, /boundaryRetries\[owner\]/);
  assert.match(allocator, /ArmBoundaryRetryState\(/);
});


test('nonurgent App timer wakes are coalesced without delaying urgent recovery', () => {
  const begin = appSource.indexOf('void App::ScheduleNextTick(uint32_t milliseconds) {');
  const end = appSource.indexOf('void App::InvalidateAll()', begin);
  assert.ok(begin >= 0 && end > begin);
  const timer = appSource.slice(begin, end);
  assert.match(appSource, /constexpr ULONG kAppTimerToleranceMs = 100;/);
  assert.match(timer, /if \(clamped >= kFastTickMs\) \{/);
  assert.match(timer, /SetCoalescableTimer\(\s*window_, kCentralTimer, clamped, nullptr, kAppTimerToleranceMs\)/);
  assert.match(timer, /if \(!timer\) timer = SetTimer\(window_, kCentralTimer, clamped, nullptr\)/);
  assert.match(timer, /nextAppTickAt_ = timer \? static_cast<int64_t>\(dueTick\) : 0;/);
  assert.ok(timer.indexOf('if (clamped >= kFastTickMs)') <
    timer.indexOf('SetCoalescableTimer('));
  assert.ok(timer.indexOf('SetCoalescableTimer(') <
    timer.indexOf('if (!timer) timer = SetTimer('));
  // Short, event-driven callbacks never route through the tolerant API.
  const usesCoalescing = delayMs => delayMs >= 2000;
  assert.equal(usesCoalescing(1), false);
  assert.equal(usesCoalescing(1500), false);
  assert.equal(usesCoalescing(2000), true);
  assert.equal(usesCoalescing(60_000), true);
});


test('nonurgent YouTube and media phase timers use OS wake coalescing with exact recovery fallback', () => {
  const begin = nativeMediaHost.indexOf('  UINT_PTR ArmTimer(UINT_PTR timerId, UINT intervalMs) noexcept {');
  const end = nativeMediaHost.indexOf('  HRESULT ExecutePolicyScript(', begin);
  assert.ok(begin >= 0 && end > begin);
  const method = nativeMediaHost.slice(begin, end);
  assert.match(nativeMediaHost, /static constexpr ULONG kMediaTimerToleranceMs = 100/);
  assert.match(method, /if \(timerId == kNativeMediaTverWatchdogTimer\) \{\s*return ArmNativeMediaTrustedWakeTimer\(/);
  assert.match(method, /if \(intervalMs >= 5'000 &&\s*\(timerId == kNativeMediaPhaseTimer \|\|\s*timerId == kNativeMediaYoutubeWatchdogTimer\)\)/);
  assert.match(method, /SetCoalescableTimer\(\s*hostWindow_, timerId, intervalMs, nullptr, kMediaTimerToleranceMs\)/);
  assert.match(method, /if \(coalesced\) return coalesced/);
  assert.match(method, /return ::SetTimer\(hostWindow_, timerId, intervalMs, nullptr\)/);
  const coalesces = (kind, ms) =>
    (kind === 'phase' || kind === 'youtube-watchdog') && ms >= 5000;
  assert.equal(coalesces('phase', 3_600_000), true);
  assert.equal(coalesces('youtube-watchdog', 60_000), true);
  assert.equal(coalesces('youtube-watchdog', 1_000), false);
  assert.equal(coalesces('navigation-retry', 30_000), false);
  assert.equal(coalesces('tver-watchdog', 60_000), false);
});
