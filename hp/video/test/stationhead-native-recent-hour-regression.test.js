import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url),
  'utf8',
);

const bucketMs = 5 * 60 * 1000;
const windowMs = 2 * 60 * 60 * 1000;
const maximumSamples = windowMs / bucketMs + 1;

function publishSample(samples, receivedAt, value) {
  const bucket = Math.floor(receivedAt / bucketMs) * bucketMs;
  const existing = samples.findIndex(sample => sample.timestamp === bucket);
  if (existing >= 0) {
    samples[existing].value = value;
  } else {
    const position = samples.findIndex(sample => sample.timestamp > bucket);
    const insertion = position >= 0 ? position : samples.length;
    samples.splice(insertion, 0, { timestamp: bucket, value });
  }
  const cutoff = receivedAt - windowMs;
  while (samples.length && samples[0].timestamp < cutoff) samples.shift();
  while (samples.length > maximumSamples) samples.shift();
}

function recentHour(samples) {
  if (samples.length < 2) return -1;
  const latest = samples.at(-1);
  const target = latest.timestamp - 60 * 60 * 1000;
  const baseline = samples.findLast(sample => sample.timestamp <= target);
  if (!baseline) return -1;
  const delta = latest.value - baseline.value;
  return delta >= 0 ? delta : latest.value;
}

test('native history keeps one bounded sample per five-minute bucket', () => {
  assert.match(source, /kRecentHistoryWindowMs = 2LL \* 60 \* 60 \* 1000/);
  assert.match(source, /kRecentHistoryBucketMs = 5LL \* 60 \* 1000/);
  assert.match(source, /kMaximumRecentHistorySamples/);
  assert.match(source, /std::lower_bound\(/);
  assert.match(source, /position->second = current->value/);
  assert.match(source, /history_\.size\(\) > kMaximumRecentHistorySamples/);
  assert.doesNotMatch(
    source,
    /history_\[history_\.size\(\) - 2\]\.second == history_\.back\(\)\.second/,
  );
});

test('duplicate responses in one bucket replace instead of growing history', () => {
  const start = Date.UTC(2026, 7, 2, 12, 0, 0);
  const samples = [];
  for (let index = 0; index < 1000; index += 1) {
    publishSample(samples, start + index, 120 + index);
  }
  assert.equal(samples.length, 1);
  assert.equal(samples[0].value, 1119);
});

test('an unchanged counter reports zero after one hour and remains bounded', () => {
  const start = Date.UTC(2026, 7, 2, 12, 0, 0);
  const samples = [];
  for (let index = 0; index <= 36; index += 1) {
    publishSample(samples, start + index * bucketMs, 120);
  }
  assert.equal(samples.length, maximumSamples);
  assert.equal(recentHour(samples), 0);
});

test('the one-hour delta reports increases and handles UTC-day resets', () => {
  const start = Date.UTC(2026, 7, 2, 23, 0, 0);
  const increasing = [];
  for (let index = 0; index < 14; index += 1) {
    publishSample(
      increasing,
      start + index * bucketMs,
      50 + Math.floor(index / 4),
    );
  }
  assert.equal(recentHour(increasing), 3);

  const reset = [];
  publishSample(reset, start, 98);
  publishSample(reset, start + 65 * 60 * 1000, 2);
  assert.equal(recentHour(reset), 2);
});
