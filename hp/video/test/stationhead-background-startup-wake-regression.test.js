import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);

test('background Stationhead keeps App ticks alive until audio starts', () => {
  const schedulerStart = app.indexOf('if (stationheadStarted_ && stationhead_) {');
  assert.ok(schedulerStart >= 0);
  const scheduler = app.slice(schedulerStart, schedulerStart + 1200);

  assert.match(
    scheduler,
    /StationheadNeedsForeground\(stationheadStatus\) \|\|\s*!stationheadStatus\.audioPlaying/,
  );
  assert.match(scheduler, /nextTickMs = std::min\(nextTickMs, kFastTickMs\)/);
  assert.match(
    scheduler,
    /NextDelayFromDeadline\(now, stationhead_->NextWakeAt\(\), kMaxAppTimerMs\)/,
  );
});
