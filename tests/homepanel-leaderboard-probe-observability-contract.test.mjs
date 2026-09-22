import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeLeaderboardProbeStatus } from '../.github/scripts/capture-stationhead-leaderboard-probe-status.mjs';
import { expectAll, readSource } from './helpers/source-contract.mjs';

test('leaderboard probe diagnostics are mirrored into the canonical observability artifact', () => {
  const action = readSource('.github/actions/cloudflare-observability-diagnostics/action.yml');
  const workflow = readSource('.github/workflows/sh-observability.yml');

  expectAll(action, [
    'capture-stationhead-leaderboard-probe-status.mjs',
    '/api/health/stationhead-leaderboard-probe',
    'observability-gate/stationhead-leaderboard-probe-status.json',
    'stationhead-leaderboard-probe-summary.md',
    'Leaderboard probe diagnostic mirror unavailable',
  ]);
  expectAll(workflow, [
    '.github/actions/cloudflare-observability-diagnostics',
    'observability-gate/',
    'cloudflare-observability-report-unified-',
  ]);
});

test('leaderboard probe mirror whitelists only non-secret diagnostic fields', () => {
  const sanitized = sanitizeLeaderboardProbeStatus({
    version: 1,
    updated_at: '2026-09-22T00:00:00.000Z',
    stage: 'native_spooled',
    native: {
      spool_records: 3,
      batch_records: 2,
      diagnostic_schema: 2,
      collector_stage: 'navigation_completed',
      last_success_stage: 'navigation_completed',
      collector_started: true,
      collector_ticked: true,
      last_transition_at: '2026-09-22T00:00:00.500Z',
      last_failure_at: null,
      last_error: 'none',
      exchange_at: '2026-09-22T00:00:00.750Z',
      device_id: 'must-not-survive',
    },
    cloud: {
      reached: true,
      probe_submitted: true,
      accepted: 2,
      stored: true,
      dispatch_ok: false,
      error: 'none',
      authorization: 'Bearer secret',
    },
    history: {
      last_probe_received_at: '2026-09-22T00:00:01.000Z',
      last_stored_at: '2026-09-22T00:00:02.000Z',
      last_reported_at: null,
    },
    cookie: 'secret-cookie',
    body: '{"leaderboard":"secret"}',
  });

  assert.deepEqual(sanitized, {
    version: 1,
    updated_at: '2026-09-22T00:00:00.000Z',
    stage: 'native_spooled',
    native: {
      spool_records: 3,
      batch_records: 2,
      diagnostic_schema: 2,
      collector_stage: 'navigation_completed',
      last_success_stage: 'navigation_completed',
      collector_started: true,
      collector_ticked: true,
      last_transition_at: '2026-09-22T00:00:00.500Z',
      last_failure_at: null,
      last_error: 'none',
      exchange_at: '2026-09-22T00:00:00.750Z',
    },
    cloud: {
      reached: true,
      probe_submitted: true,
      accepted: 2,
      stored: true,
      dispatch_ok: false,
      error: 'none',
    },
    history: {
      last_probe_received_at: '2026-09-22T00:00:01.000Z',
      last_stored_at: '2026-09-22T00:00:02.000Z',
      last_reported_at: null,
    },
  });
  assert.equal(JSON.stringify(sanitized).includes('secret'), false);
  assert.equal(JSON.stringify(sanitized).includes('device_id'), false);
});
