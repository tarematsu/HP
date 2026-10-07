import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dashboardGoalPredictions,
  dashboardGoalTargets,
  linearRegressionPrediction,
  linearRegressionPredictionFromAggregate,
} from '../packages/sh-shared/dashboard-prediction.mjs';

test('aggregate prediction matches row-based regression without returning source rows', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    observed_at: 1_000_000 + index * 300_000,
    current_stream_count: 100 + index * 5,
  }));
  const firstT = rows[0].observed_at;
  const xs = rows.map((row) => (row.observed_at - firstT) / 3_600_000);
  const ys = rows.map((row) => row.current_stream_count);
  const aggregate = {
    sample_count: rows.length,
    first_t: rows[0].observed_at,
    last_t: rows.at(-1).observed_at,
    x_mean: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    y_mean: ys.reduce((sum, value) => sum + value, 0) / ys.length,
    xy_mean: xs.reduce((sum, value, index) => sum + value * ys[index], 0) / xs.length,
    xx_mean: xs.reduce((sum, value) => sum + value * value, 0) / xs.length,
    latest_y: ys.at(-1),
  };
  const now = rows.at(-1).observed_at;
  const fromRows = linearRegressionPrediction(rows, 180, now);
  const fromAggregate = linearRegressionPredictionFromAggregate(aggregate, 180, now);

  assert.ok(fromRows);
  assert.ok(fromAggregate);
  assert.equal(fromAggregate.sample_count, 5);
  assert.ok(Math.abs(fromAggregate.rate_per_hour - fromRows.rate_per_hour) < 1e-8);
  assert.ok(Math.abs(fromAggregate.eta - fromRows.eta) < 1);
});

test('dashboard predicts configured and five-million round goals from one trend', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    observed_at: 1_000_000 + index * 300_000,
    current_stream_count: 49_000_000 + index * 100_000,
  }));
  assert.deepEqual(
    dashboardGoalTargets(49_400_000, 53_240_000),
    [50_000_000, 53_240_000, 55_000_000, 60_000_000],
  );
  const result = dashboardGoalPredictions({
    rows,
    current: 49_400_000,
    configuredGoal: 53_240_000,
    now: 2_000_000,
  });
  assert.equal(result.goalPrediction.goal, 53_240_000);
  assert.deepEqual(result.goalPredictions.map(({ goal }) => goal), [
    50_000_000, 53_240_000, 55_000_000, 60_000_000,
  ]);
});
