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

test('startup-only X runs for two minutes even in power saving, then TVer stays uninterrupted', () => {
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
UINT_PTR SetTimer(HWND, UINT_PTR id, UINT delay, void*) { timers[id] = delay; return id; }
bool gNativeMediaPowerSaving = false;
${section(base, 'constexpr wchar_t kNativeMediaYoutubeContentUrl', 'constexpr UINT kNativeMediaNavigationRetryMs')}
${section(base, 'struct NativeMediaContentPlan', 'constexpr const wchar_t* kNativeMediaPlayAllScript')}
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
  bool phaseStarted_ = false, startupXActive_ = true;
  int navigations = 0, switches = 0;
  UINT_PTR ArmTimer(UINT_PTR id, UINT delay) { timers[id] = delay; return id; }
  void Fail() { assert(false); }
  void StopYoutubeMonitors() {}
  void StopTverPlaybackMonitor() {}
  void StopNavigationRetry() {}
  void ProbeYoutubeWatchdog() {}
  void ProbeTverWatchdog() {}
  void NavigateCurrentPhase() { ++navigations; }
  void SwitchToTver() { phase_ = Phase::Tver; ++switches; ArmPhaseTimer(); }
  void SwitchToYouTube() { phase_ = Phase::YouTube; ++switches; ArmPhaseTimer(); }
${section(host, '  void ApplyPowerSavingMode()', '  void SetMuted(')}
${section(host, '  bool OnTimer(', '  void Paint(')}
${section(host, '  void ArmPhaseTimer(', '  void SwitchToYouTube()')}
};
int main() {
  constexpr UINT minute = 60000;
  Host h;
  gNativeMediaPowerSaving = true; // 12:00-20:00 must still allow the startup X.
  h.ArmPhaseTimer();
  assert(timers[kNativeMediaPhaseTimer] == 2 * minute);
  h.OnTimer(kNativeMediaPhaseTimer); // Queued early timer must not skip X.
  assert(h.startupXActive_ && h.navigations == 0);

  tick += 2 * minute;
  h.OnTimer(kNativeMediaPhaseTimer);
  assert(!h.startupXActive_ && h.navigations == 1);
  assert(h.phase_ == Host::Phase::YouTube);
  assert(timers[kNativeMediaPhaseTimer] == 60 * minute);

  tick += 60 * minute;
  h.OnTimer(kNativeMediaPhaseTimer);
  assert(h.phase_ == Host::Phase::Tver && h.switches == 1);
  assert(timers[kNativeMediaPhaseTimer] == 60 * minute);

  tick += 20 * minute;
  gNativeMediaPowerSaving = false;
  h.ApplyPowerSavingMode();
  const UINT remainingTver = timers[kNativeMediaPhaseTimer];
  assert(remainingTver >= 25 * minute && remainingTver <= 35 * minute);

  tick += remainingTver;
  h.OnTimer(kNativeMediaPhaseTimer);
  assert(h.phase_ == Host::Phase::YouTube && h.switches == 2);
  assert(timers[kNativeMediaPhaseTimer] >= 50 * minute);
  assert(timers[kNativeMediaPhaseTimer] <= 60 * minute);
  assert(!h.startupXActive_ && h.navigations == 1);
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
  assert.match(base, /TVer owns this WebView continuously/);
  assert.doesNotMatch(read('renderer_panels/media_tver_cloud_queue_refresh.inc'), /NativeMediaTverXPhaseActive|NativeMediaXSlotEnabled/);
});
