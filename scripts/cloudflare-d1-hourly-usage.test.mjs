import assert from 'node:assert/strict';
import test from 'node:test';

const FREE_READ_ROWS_PER_DAY = 5_000_000;
const FREE_WRITE_ROWS_PER_DAY = 100_000;
const TARGET_RATIO = 1;

function hourlyTarget(dailyLimit) {
  return (dailyLimit * TARGET_RATIO) / 24;
}

function exceeds(observed, target) {
  return Number(observed || 0) >= Number(target || 0);
}

test('100 percent free-tier budget is converted to an hourly rate', () => {
  assert.equal(hourlyTarget(FREE_READ_ROWS_PER_DAY), 208_333.33333333334);
  assert.equal(hourlyTarget(FREE_WRITE_ROWS_PER_DAY), 4_166.666666666667);
});

test('the hourly gate requires usage to stay strictly below the target', () => {
  const target = hourlyTarget(FREE_WRITE_ROWS_PER_DAY);
  assert.equal(exceeds(target - 1, target), false);
  assert.equal(exceeds(target, target), true);
});
