import assert from 'node:assert/strict';
import test from 'node:test';

import { auditListenerAnomalies } from '../src/listener-anomaly-audit.js';

const BASE = Date.parse('2026-09-22T00:00:00Z');

function rows(values, options = {}) {
  const broadcasting = options.broadcasting ?? true;
  return values.map((listenerCount, index) => ({
    id: index + 1,
    minute_at: BASE + index * 60_000,
    listener_count: listenerCount,
    is_broadcasting: broadcasting ? 1 : 0,
  }));
}

test('stable broadcasting listener series is not flagged', () => {
  const result = auditListenerAnomalies(rows([101, 100, 103, 99, 102, 101, 100]));
  assert.equal(result.anomaly_count, 0);
  assert.equal(result.broadcast_median, 101);
});

test('broadcasting listener count at or below 15 is flagged when surrounding traffic is normal', () => {
  const result = auditListenerAnomalies(rows([104, 101, 100, 12, 99, 102, 103]));
  assert.equal(result.anomaly_count, 1);
  assert.equal(result.hard_low_count, 1);
  assert.equal(result.anomalies[0].listener_count, 12);
  assert.equal(result.anomalies[0].reason, 'implausibly_low_listener');
});

test('isolated local collapse above 15 is also flagged', () => {
  const result = auditListenerAnomalies(rows([100, 102, 101, 103, 20, 99, 101, 104, 100]));
  assert.equal(result.anomaly_count, 1);
  assert.equal(result.local_collapse_count, 1);
  assert.equal(result.anomalies[0].reason, 'local_listener_collapse');
});

test('small broadcasts are not mislabeled solely because the listener count is low', () => {
  const result = auditListenerAnomalies(rows([9, 10, 11, 8, 10, 9, 11]));
  assert.equal(result.anomaly_count, 0);
  assert.equal(result.broadcast_median, 10);
});

test('off-air zero listener rows are ignored', () => {
  const result = auditListenerAnomalies(rows([0, 0, 0, 0, 0], { broadcasting: false }));
  assert.equal(result.anomaly_count, 0);
  assert.equal(result.broadcast_sample_count, 0);
});

test('missing listener value while broadcasting is flagged', () => {
  const result = auditListenerAnomalies(rows([100, 101, null, 103, 102]));
  assert.equal(result.invalid_listener_count, 1);
  assert.equal(result.anomalies[0].reason, 'missing_or_invalid_listener');
});

test('latest duplicate minute row wins before anomaly classification', () => {
  const input = rows([100, 101, 102, 103, 104]);
  input.push({ id: 99, minute_at: input[2].minute_at, listener_count: 5, is_broadcasting: 1 });
  const result = auditListenerAnomalies(input);
  assert.equal(result.rows.length, 5);
  assert.equal(result.hard_low_count, 1);
  assert.equal(result.anomalies[0].listener_count, 5);
});
