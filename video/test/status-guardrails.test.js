import assert from 'node:assert/strict';
import test from 'node:test';

import { collectionRunStatus } from '../src/status.js';

test('incomplete runs are running before their source limit', () => {
  const now = Date.parse('2026-07-02T01:31:00.000Z');
  assert.equal(collectionRunStatus({
    startedAt: '2026-07-02T01:30:00.000Z',
    completedAt: null,
    error: null
  }, 'source-e-browser', null, now), 'running');
});

test('incomplete runs become stalled after their source limit and grace period', () => {
  const now = Date.parse('2026-07-02T01:40:00.000Z');
  assert.equal(collectionRunStatus({
    startedAt: '2026-07-02T01:30:00.000Z',
    completedAt: null,
    error: null
  }, 'source-a-fetch', null, now), 'stalled');
});

test('completed timeout rows are errors rather than stalled', () => {
  assert.equal(collectionRunStatus({
    startedAt: '2026-07-02T01:30:00.000Z',
    completedAt: '2026-07-02T01:32:20.000Z',
    error: 'source-a-fetch timed out after 140000 ms'
  }, 'source-a-fetch'), 'error');
});
