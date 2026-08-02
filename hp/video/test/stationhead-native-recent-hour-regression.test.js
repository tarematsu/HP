import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url),
  'utf8',
);

function recentHour(samples) {
  if (samples.length < 2) return -1;
  const latest = samples.at(-1);
  const target = latest.timestamp - 60 * 60 * 1000;
  const baseline = samples.findLast(sample => sample.timestamp <= target);
  if (!baseline) return -1;
  const delta = latest.value - baseline.value;
  return delta >= 0 ? delta : latest.value;
}

test('flat play-count samples are retained for the one-hour baseline', () => {
  assert.match(source, /history_\.push_back\(\{receivedAt, current->value\}\)/);
  assert.match(source, /history_\.front\(\)\.first < cutoff/);
  assert.doesNotMatch(
    source,
    /history_\[history_\.size\(\) - 2\]\.second == history_\.back\(\)\.second/,
  );
  assert.doesNotMatch(source, /history_\.erase\(history_\.end\(\) - 2\)/);
});

test('an unchanged counter reports zero after one hour instead of unavailable', () => {
  const start = Date.UTC(2026, 7, 2, 12, 0, 0);
  const samples = Array.from({ length: 14 }, (_, index) => ({
    timestamp: start + index * 5 * 60 * 1000,
    value: 120,
  }));
  assert.equal(recentHour(samples), 0);
});

test('the one-hour delta still reports increases and handles UTC-day resets', () => {
  const start = Date.UTC(2026, 7, 2, 23, 0, 0);
  const increasing = Array.from({ length: 14 }, (_, index) => ({
    timestamp: start + index * 5 * 60 * 1000,
    value: 50 + Math.floor(index / 4),
  }));
  assert.equal(recentHour(increasing), 3);

  const reset = [
    { timestamp: start, value: 98 },
    { timestamp: start + 65 * 60 * 1000, value: 2 },
  ];
  assert.equal(recentHour(reset), 2);
});
