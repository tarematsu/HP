import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, readSource } from './helpers/source-contract.mjs';

test('HomePanel migrations preserve optimized runtime schema', () => {
  const readHotspots = readSource('hp/cloud/migrations/202607230500_d1_read_hotspots.sql');
  const runtimeReduction = readSource('hp/cloud/migrations/202607240200_d1_runtime_reduction.sql');
  const switchBotSplit = readSource(
    'hp/cloud/migrations/202609120100_split_switchbot_dashboard_version.sql',
  );

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
  expectAll(switchBotSplit, [
    'dashboard_version = MAX(0, dashboard_version - switchbot_version)',
    "'weather','news','octopus','stationhead','environment'",
    "switchbot_version = CASE WHEN NEW.source='switchbot' THEN NEW.version ELSE switchbot_version END",
    '20260912-split-switchbot-dashboard-version',
  ]);
  assert.ok(!switchBotSplit.includes("'weather','news','octopus','switchbot','stationhead','environment'\n         ) THEN NEW.version"));
});
