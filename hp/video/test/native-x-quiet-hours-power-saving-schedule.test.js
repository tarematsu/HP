import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const tverQueue = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');
const powerSavingSchedule = readFileSync(
  new URL('../../native/src/power_saving_schedule.inc', import.meta.url), 'utf8');

test('native X random draw is independent from quiet hours and runtime gating happens only when a selected slot is due', () => {
  assert.match(mediaBase, /kNativeMediaXQuietStartSecond = 1 \* 60 \* 60/);
  assert.match(mediaBase, /kNativeMediaXQuietEndSecond = 6 \* 60 \* 60/);
  assert.match(
    mediaBase,
    /bool NativeMediaXSlotEnabled\(bool firstSlot\) noexcept \{\s*const auto& plan = NativeMediaCurrentXCyclePlan\(\);\s*return firstSlot \? plan\.firstSlot : plan\.secondSlot;\s*\}/,
  );
  assert.match(
    mediaBase,
    /bool NativeMediaHostSuppressX\([\s\S]*bool tver, bool phaseStarted, ULONGLONG phaseStartedAt,[\s\S]*bool xPhaseActive\) noexcept/,
  );
  assert.match(mediaBase, /if \(xPhaseActive\) return !NativeMediaXRuntimeAllowed\(\)/);
  assert.match(mediaBase, /if \(!phaseStarted\) return false/);
  assert.match(mediaBase, /return now - phaseStartedAt >= xStartMs && !NativeMediaXRuntimeAllowed\(\)/);
  assert.match(
    mediaBase,
    /#define gNativeMediaPowerSaving NativeMediaHostSuppressX\([\s\S]*phase_ == Phase::Tver, phaseStarted_, phaseStartedAt_, xPhaseActive_\)/,
  );
  assert.match(
    mediaBase,
    /gNativeMediaPowerSaving \|\| !NativeMediaXSlotEnabled\(true\) \|\|[\s\S]*!NativeMediaXRuntimeAllowed\(\)/,
  );
  assert.match(
    tverQueue,
    /gNativeMediaPowerSaving \|\| !NativeMediaXSlotEnabled\(true\)\) return false;\s*if \(!NativeMediaXRuntimeAllowed\(\)\) return false/,
  );
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
