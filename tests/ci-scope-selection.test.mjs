import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectHomePanelScopes,
  selectStationheadScopes,
} from '../.github/scripts/ci/select-scopes.mjs';

test('Stationhead workflow-only changes use the lightweight contract path', () => {
  assert.deepEqual(selectStationheadScopes(['.github/workflows/ci.yml']), {
    pages: false,
    worker: false,
    sql: false,
    repository_full: false,
  });
});

test('Stationhead folders select only their affected jobs', () => {
  assert.deepEqual(selectStationheadScopes(['site/functions/api/health.js']), {
    pages: true,
    worker: false,
    sql: false,
    repository_full: true,
  });
  assert.deepEqual(selectStationheadScopes(['worker/tests/example.test.js']), {
    pages: false,
    worker: true,
    sql: false,
    repository_full: true,
  });
});

test('HomePanel integration tests cannot bypass the full suite', () => {
  assert.deepEqual(
    selectHomePanelScopes(['hp/cloud/test/device_exchange.integration.test.ts']),
    {
      cloud: true,
      video: false,
      bundle: false,
      contracts: false,
      integration: true,
      migrations: false,
    },
  );
});

test('HomePanel video and contract changes stay in separate scopes', () => {
  assert.deepEqual(selectHomePanelScopes(['hp/video/src/index.js']), {
    cloud: false,
    video: true,
    bundle: true,
    contracts: false,
    integration: false,
    migrations: false,
  });
  assert.deepEqual(selectHomePanelScopes(['.github/scripts/audit-cloudflare-daily-usage.py']), {
    cloud: false,
    video: false,
    bundle: false,
    contracts: true,
    integration: false,
    migrations: false,
  });
});

test('manual and selector changes retain complete validation', () => {
  const expectedStationhead = {
    pages: true,
    worker: true,
    sql: true,
    repository_full: true,
  };
  const expectedHomePanel = {
    cloud: true,
    video: true,
    bundle: true,
    contracts: true,
    integration: true,
    migrations: true,
  };
  assert.deepEqual(selectStationheadScopes([], { all: true }), expectedStationhead);
  assert.deepEqual(
    selectStationheadScopes(['.github/scripts/ci/select-scopes.mjs']),
    expectedStationhead,
  );
  assert.deepEqual(selectHomePanelScopes([], { all: true }), expectedHomePanel);
  assert.deepEqual(
    selectHomePanelScopes(['.github/scripts/ci/select-scopes.mjs']),
    expectedHomePanel,
  );
});
