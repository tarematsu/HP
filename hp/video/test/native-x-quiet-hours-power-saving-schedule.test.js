import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const tverQueue = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');
const powerSavingSchedule = readFileSync(
  new URL('../../native/src/power_saving_schedule.inc', import.meta.url), 'utf8');

test('startup X ignores prior quiet-hour gating and survives midday power saving', () => {
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs = 2U \* 60U \* 1000U/);
  assert.doesNotMatch(mediaBase, /NativeMediaXRuntimeAllowed|NativeMediaXCanStartAtSecondOfDay/);
  assert.doesNotMatch(mediaBase, /NativeMediaXSlotEnabled|NativeMediaHostSuppressX/);
  assert.match(mediaBase, /if \(gNativeMediaPowerSaving\) return kNativeMediaYoutubeContentPhaseMs/);
  assert.doesNotMatch(tverQueue, /NativeMediaTverXPhaseActive/);
  assert.match(mediaBase, /#include "media_host.inc"/);
});

test('scheduled power-saving mode runs from 12:00 through 19:59', () => {
  assert.match(powerSavingSchedule, /kPowerSavingStartMinute = 12 \* 60/);
  assert.match(powerSavingSchedule, /kPowerSavingEndMinute = 20 \* 60/);
  assert.match(powerSavingSchedule, /static_assert\(!ScheduledPowerSavingAt\(11, 59\)\)/);
  assert.match(powerSavingSchedule, /static_assert\(ScheduledPowerSavingAt\(12, 0\)\)/);
  assert.match(powerSavingSchedule, /static_assert\(ScheduledPowerSavingAt\(19, 59\)\)/);
  assert.match(powerSavingSchedule, /static_assert\(!ScheduledPowerSavingAt\(20, 0\)\)/);
});
