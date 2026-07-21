import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSiteStatus, latestScheduledAt } from '../src/status.js';

const schedules = {
  sourceA: '30 2 * * *',
  sourceB: '30 2 * * *',
  sourceE: '30 2 * * *'
};

const TEST_NOW_MS = Date.parse('2026-07-01T03:10:00.000Z');

test('buildSiteStatus exposes counts and timings for every active source', () => {
  const result = buildSiteStatus(schedules, [
    {
      sourceMethod: 'source-a-browser',
      startedAt: '2026-07-01T02:30:00.000Z',
      completedAt: '2026-07-01T02:30:01.000Z',
      foundCount: 100,
      insertedCount: 25,
      collectionDurationMs: 50_000,
      databaseDurationMs: 8_000,
      totalDurationMs: 58_000,
      error: null
    },
    {
      sourceMethod: 'source-b-browser',
      startedAt: '2026-07-01T02:30:01.000Z',
      completedAt: '2026-07-01T02:30:06.000Z',
      foundCount: 0,
      insertedCount: 0,
      collectionDurationMs: 4_000,
      databaseDurationMs: 500,
      totalDurationMs: 4_500,
      error: 'No valid video URLs were collected'
    },
    {
      sourceMethod: 'source-e-browser',
      startedAt: '2026-07-01T02:30:06.000Z',
      completedAt: '2026-07-01T02:30:08.000Z',
      foundCount: 530,
      insertedCount: 120,
      collectionDurationMs: 800,
      databaseDurationMs: 900,
      totalDurationMs: 1_700,
      error: null
    }
  ], TEST_NOW_MS);

  assert.deepEqual(result.siteCounts, {
    sourceA: 100,
    sourceB: 0,
    sourceE: 530
  });
  assert.equal(result.sites.sourceA.status, 'ok');
  assert.equal(result.sites.sourceA.hasRun, true);
  assert.equal(result.sites.sourceA.duplicateOrExistingCount, 75);
  assert.equal(result.sites.sourceA.totalDurationMs, 58_000);
  assert.equal(result.sites.sourceB.status, 'error');
  assert.equal(result.sites.sourceE.collectionDurationMs, 800);
  assert.equal(result.sites.sourceB.schedule, '30 2 * * *');

  assert.deepEqual(result.scheduleTimings['30 2 * * *'], {
    siteKeys: ['sourceA', 'sourceB', 'sourceE'],
    measuredSites: 3,
    collectionDurationMs: 54_800,
    databaseDurationMs: 9_400,
    sequentialTotalDurationMs: 64_200,
    allSitesMeasured: true
  });

  assert.deepEqual(result.latestRunTotals, {
    collectedCount: 630,
    insertedCount: 145,
    duplicateOrExistingCount: 485,
    collectionDurationMs: 54_800,
    databaseDurationMs: 9_400,
    totalDurationMs: 64_200,
    measuredTimingSites: 3,
    successfulSites: 2,
    failedSites: 1,
    neverRunSites: 0
  });
});

test('buildSiteStatus clamps malformed counts and ignores malformed timings', () => {
  const result = buildSiteStatus(schedules, [{
    sourceMethod: 'source-e-browser',
    startedAt: '2026-07-01T02:30:06.000Z',
    completedAt: '2026-07-01T02:30:08.000Z',
    foundCount: '12',
    insertedCount: 99,
    collectionDurationMs: '-1',
    databaseDurationMs: 'invalid',
    totalDurationMs: null,
    error: null
  }], TEST_NOW_MS);

  assert.equal(result.sites.sourceE.collectedCount, 12);
  assert.equal(result.sites.sourceE.insertedCount, 12);
  assert.equal(result.sites.sourceE.duplicateOrExistingCount, 0);
  assert.equal(result.sites.sourceE.collectionDurationMs, null);
  assert.equal(result.sites.sourceE.databaseDurationMs, null);
  assert.equal(result.sites.sourceE.totalDurationMs, null);
});

test('successful but outdated runs become stale after the grace period', () => {
  const nowMs = Date.parse('2026-07-04T03:32:00.000Z');
  const result = buildSiteStatus(schedules, [{
    sourceMethod: 'source-a-browser',
    startedAt: '2026-07-04T00:00:49.757Z',
    completedAt: '2026-07-04T00:00:58.312Z',
    foundCount: 119,
    insertedCount: 79,
    error: null
  }], nowMs);

  assert.equal(result.sites.sourceA.status, 'stale');
  assert.equal(result.sites.sourceA.stale, true);
  assert.equal(result.sites.sourceA.expectedAt, '2026-07-04T02:30:00.000Z');
  assert.equal(result.latestRunTotals.successfulSites, 0);
  assert.equal(result.latestRunTotals.failedSites, 1);
});

test('latestScheduledAt uses the previous UTC day before todays schedule', () => {
  const nowMs = Date.parse('2026-07-04T02:00:00.000Z');
  assert.equal(
    new Date(latestScheduledAt('30 2 * * *', nowMs)).toISOString(),
    '2026-07-03T02:30:00.000Z'
  );
});
