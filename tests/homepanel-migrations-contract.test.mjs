import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, readSource } from './helpers/source-contract.mjs';

test('HomePanel migrations preserve optimized runtime schema', () => {
  const readHotspots = readSource('hp/cloud/migrations/202607230500_d1_read_hotspots.sql');
  const runtimeReduction = readSource('hp/cloud/migrations/202607240200_d1_runtime_reduction.sql');

  expectAll(readHotspots, [
    'CREATE TABLE IF NOT EXISTS octopus_daily_totals',
    'CREATE VIEW IF NOT EXISTS video_liveness_bounds',
    'sqlite_sequence',
  ]);
  assert.ok(!readHotspots.includes('video_liveness_bound_on_insert'));
  expectAll(runtimeReduction, [
    'CREATE TABLE sync_manifest',
    'CREATE TABLE job_events',
    'WITHOUT ROWID',
    'DROP TABLE IF EXISTS environment_samples',
    'DROP TABLE IF EXISTS environment_buckets',
    'status_counts_on_video_update',
    'status_counts_on_ranking_insert',
    'dirty=0',
  ]);
});
