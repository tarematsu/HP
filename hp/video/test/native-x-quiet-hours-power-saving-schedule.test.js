import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const powerSavingSchedule = readFileSync(
  new URL('../../native/src/power_saving_schedule.inc', import.meta.url), 'utf8');

test('native X slots stay inactive from 01:00 through 05:59 while normal media cadence remains independent', () => {
  assert.match(mediaBase, /kNativeMediaXQuietStartSecond = 1 \* 60 \* 60/);
  assert.match(mediaBase, /kNativeMediaXQuietEndSecond = 6 \* 60 \* 60/);
  assert.match(mediaBase, /if \(!NativeMediaXRuntimeAllowed\(\)\) return false/);
  assert.match(mediaBase, /bool NativeMediaHostSuppressX\(\) noexcept/);
  assert.match(mediaBase, /return gNativeMediaPowerSaving \|\| !NativeMediaXRuntimeAllowed\(\)/);
  assert.match(mediaBase, /#define gNativeMediaPowerSaving NativeMediaHostSuppressX\(\)/);
  assert.match(mediaBase, /#undef gNativeMediaPowerSaving/);
  assert.match(mediaBase, /static_assert\(!NativeMediaXCanStartAtSecondOfDay\(1 \* 60 \* 60\)\)/);
  assert.match(mediaBase, /static_assert\(NativeMediaXCanStartAtSecondOfDay\(6 \* 60 \* 60\)\)/);
});

test('scheduled power-saving mode runs from 12:00 through 19:59', () => {
  assert.match(powerSavingSchedule, /kPowerSavingStartMinute = 12 \* 60/);
  assert.match(powerSavingSchedule, /kPowerSavingEndMinute = 20 \* 60/);
  assert.match(powerSavingSchedule, /static_assert\(!ScheduledPowerSavingAt\(11, 59\)\)/);
  assert.match(powerSavingSchedule, /static_assert\(ScheduledPowerSavingAt\(12, 0\)\)/);
  assert.match(powerSavingSchedule, /static_assert\(ScheduledPowerSavingAt\(19, 59\)\)/);
  assert.match(powerSavingSchedule, /static_assert\(!ScheduledPowerSavingAt\(20, 0\)\)/);
});
