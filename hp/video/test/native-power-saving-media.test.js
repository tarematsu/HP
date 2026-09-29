import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const read = path => readFileSync(new URL(`../../native/src/${path}`, import.meta.url), 'utf8');
const host = read('renderer_panels/media_host.inc');
const base = read('renderer_panels/media_section_base.inc');
const schedule = read('power_saving_schedule.inc');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('native timers honor power saving and preserve elapsed phase time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-media-power-'));
  try {
    const code = `
#include <algorithm>
#include <cassert>
#include <map>
using UINT = unsigned int;
using UINT_PTR = unsigned long long;
using ULONGLONG = unsigned long long;
using HWND = int;
using int64_t = long;
std::map<UINT_PTR, UINT> timers;
ULONGLONG tick = 100;
ULONGLONG GetTickCount64() { return tick; }
bool IsWindow(HWND h) { return h != 0; }
void KillTimer(HWND, UINT_PTR id) { timers.erase(id); }
bool gNativeMediaPowerSaving = false;
${section(base, 'constexpr wchar_t kNativeMediaYoutubeContentUrl', 'constexpr UINT kNativeMediaNavigationRetryMs')}
${section(base, 'struct NativeMediaXCyclePlan', 'constexpr const wchar_t* kNativeMediaPlayAllScript')}
#define kNativeMediaYoutubeContentPhaseMs NativeMediaYoutubeContentIntervalMs()
#define kNativeMediaTverContentDurationMs NativeMediaTverContentIntervalMs()
#define kNativeMediaPhaseMs NativeMediaPhaseIntervalMs(phase_ == Phase::Tver)
${section(schedule, 'constexpr int kPowerSavingStartMinute', 'static_assert(kMonitorAuthProbeIntervalMs')}
class Host {
public:
  enum class Phase { YouTube, Tver };
  HWND hostWindow_ = 1;
  Phase phase_ = Phase::YouTube;
  ULONGLONG phaseStartedAt_ = 0;
  bool phaseStarted_ = false, xPhaseActive_ = false;
  int navigations = 0, switches = 0;
  UINT_PTR ArmTimer(UINT_PTR id, UINT delay) { timers[id] = delay; return id; }
  void Fail() { assert(false); }
  void StopYoutubeMonitors() {}
  void StopTverPlaybackMonitor() {}
  void StopNavigationRetry() {}
  void ProbeYoutubeWatchdog() {}
  void ProbeTverWatchdog() {}
  void NavigateCurrentPhase() { ++navigations; }
  void ForceAllXSlots(bool tverPhase) {
    NativeMediaCurrentXCyclePlan() = {true, true};
    NativeMediaXCyclePlanInitialized() = true;
    NativeMediaXCycleLastPhaseTver() = tverPhase;
  }
  void SwitchToTver() { phase_ = Phase::Tver; ++switches; ForceAllXSlots(true); ArmPhaseTimer(); }
  void SwitchToYouTube() { phase_ = Phase::YouTube; ++switches; ForceAllXSlots(false); ArmPhaseTimer(); }
${section(host, '  void ApplyPowerSavingMode()', '  void SetMuted(')}
${section(host, '  bool OnTimer(', '  void Paint(')}
${section(host, '  void ArmPhaseTimer(', '  void SwitchToYouTube()')}
};
int main() {
  constexpr UINT minute = 60000;
  Host h;
  h.ForceAllXSlots(false);
  h.ArmPhaseTimer();
  assert(timers[kNativeMediaPhaseTimer] == 62 * minute);
  assert(timers[kNativeMediaXStartTimer] == 61 * minute);
  h.OnTimer(kNativeMediaXStartTimer);
  assert(!h.xPhaseActive_ && timers[kNativeMediaXStartTimer] == 61 * minute);
  tick += 30 * minute;
  gNativeMediaPowerSaving = true;
  h.ApplyPowerSavingMode();
  assert(timers[kNativeMediaPhaseTimer] == 30 * minute);
  assert(timers.count(kNativeMediaXStartTimer) == 0);
  h.OnTimer(kNativeMediaXStartTimer); // stale queued timer cannot open X
  assert(!h.xPhaseActive_ && h.navigations == 0);
  tick += 30 * minute;
  h.OnTimer(kNativeMediaPhaseTimer);
  assert(h.phase_ == Host::Phase::Tver);
  assert(timers[kNativeMediaPhaseTimer] == 60 * minute);
  assert(timers.count(kNativeMediaXStartTimer) == 0);
  tick += 20 * minute;
  gNativeMediaPowerSaving = false;
  h.ApplyPowerSavingMode();
  assert(timers[kNativeMediaPhaseTimer] == 39 * minute);
  assert(timers[kNativeMediaXStartTimer] == 38 * minute);
  tick += 38 * minute;
  h.OnTimer(kNativeMediaXStartTimer);
  assert(h.xPhaseActive_);
  gNativeMediaPowerSaving = true;
  h.ApplyPowerSavingMode();
  assert(!h.xPhaseActive_);
  assert(timers[kNativeMediaPhaseTimer] == 2 * minute);
  assert(h.navigations == 2); // enter X, then restore TVer
  tick += minute;
  gNativeMediaPowerSaving = false;
  h.ApplyPowerSavingMode();
  assert(h.phase_ == Host::Phase::YouTube); // expired normal phase advances
  tick += 60 * minute;
  h.OnTimer(kNativeMediaXStartTimer);
  gNativeMediaPowerSaving = true;
  h.ApplyPowerSavingMode();
  assert(h.phase_ == Host::Phase::Tver && !h.xPhaseActive_);
  assert(timers[kNativeMediaPhaseTimer] == 60 * minute);
}
`;
    writeFileSync(join(dir, 'test.cpp'), code.replace('WM_USER + 0x4D', '0x400 + 0x4D'));
    execFileSync('g++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', join(dir, 'test.cpp'), '-o', join(dir, 'test')]);
    execFileSync(join(dir, 'test'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('actual power-saving state controls media; monitor-only hiding does not', () => {
  assert.match(schedule, /SetNativeMediaPowerSavingMode\(powerSaving_\)/);
  assert.match(schedule, /boundary\.tm_hour = kPowerSavingStartMinute \/ 60/);
  assert.match(schedule, /boundary\.tm_hour = kPowerSavingEndMinute \/ 60/);
  assert.match(read('renderer_panels/media_tver_cloud_queue_refresh.inc'), /NativeMediaTverXPhaseActive\(\) noexcept \{\s*if \(gNativeMediaPowerSaving\) return false/);
});
