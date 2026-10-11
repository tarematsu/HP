import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const tverQueue = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');
const powerSavingSchedule = readFileSync(
  new URL('../../native/src/power_saving_schedule.inc', import.meta.url), 'utf8');

test('every launch runs the two-minute X phase regardless of the clock and power-saving mode', () => {
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs = 2U \\* 60U \\* 1000U/);
  assert.match(mediaHost, /startupXActive_ = true;[\\s\\S]*CreateControllerForCurrentPhase\\(\\)/);
  const navigation = mediaHost.slice(
    mediaHost.indexOf('  void NavigateCurrentPhase()'),
    mediaHost.indexOf('  bool IsTverPage()'),
  );
  assert.match(navigation, /if \\(startupXActive_\\) \\{[\\s\\S]*webview_->Navigate\\(kNativeMediaStartupXUrl\\)/);
  assert.doesNotMatch(navigation, /gNativeMediaPowerSaving|GetLocalTime|XQuiet|XRuntimeAllowed/);
  assert.match(mediaHost, /void ApplyPowerSavingMode\\(\\) noexcept \\{[\\s\\S]*OnTimer\\(kNativeMediaPhaseTimer\\)/);
  assert.doesNotMatch(mediaBase, /NativeMediaXRuntimeAllowed|NativeMediaXCanStartAtSecondOfDay|XQuiet/);
  assert.doesNotMatch(mediaBase, /NativeMediaXSlotEnabled|NativeMediaHostSuppressX/);
  assert.doesNotMatch(tverQueue, /NativeMediaTverXPhaseActive/);
});

test('scheduled power-saving mode remains independent of startup X', () => {
  assert.match(powerSavingSchedule, /kPowerSavingStartMinute = 12 \\* 60/);
  assert.match(powerSavingSchedule, /kPowerSavingEndMinute = 20 \\* 60/);
  assert.match(powerSavingSchedule, /static_assert\\(!ScheduledPowerSavingAt\\(11, 59\\)\\)/);
  assert.match(powerSavingSchedule, /static_assert\\(ScheduledPowerSavingAt\\(12, 0\\)\\)/);
  assert.match(powerSavingSchedule, /static_assert\\(ScheduledPowerSavingAt\\(19, 59\\)\\)/);
  assert.match(powerSavingSchedule, /static_assert\\(!ScheduledPowerSavingAt\\(20, 0\\)\\)/);
});
