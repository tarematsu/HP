export const ROUND_GOAL_STEP = 5_000_000;
export const ROUND_GOAL_COUNT = 3;

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function linearRegressionModel(rows = []) {
  const points = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ t: num(row?.observed_at), y: num(row?.current_stream_count) }))
    .filter((point) => point.t != null && point.y != null)
    .sort((left, right) => left.t - right.t);
  if (points.length < 5) return null;
  const firstT = points[0].t;
  const spanMs = points.at(-1).t - firstT;
  if (spanMs < 15 * 60_000) return null;
  const xs = points.map((point) => (point.t - firstT) / 3_600_000);
  const ys = points.map((point) => point.y);
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < xs.length; index += 1) {
    covariance += (xs[index] - xMean) * (ys[index] - yMean);
    variance += (xs[index] - xMean) ** 2;
  }
  if (variance <= 0) return null;
  const ratePerHour = covariance / variance;
  if (!Number.isFinite(ratePerHour) || ratePerHour <= 0) return null;
  return {
    latest: points.at(-1).y,
    ratePerHour,
    sampleCount: points.length,
    spanHours: spanMs / 3_600_000,
  };
}

function aggregateRegressionModel(row) {
  const sampleCount = num(row?.sample_count);
  const firstT = num(row?.first_t);
  const lastT = num(row?.last_t);
  const xMean = num(row?.x_mean);
  const yMean = num(row?.y_mean);
  const xyMean = num(row?.xy_mean);
  const xxMean = num(row?.xx_mean);
  const latest = num(row?.latest_y);
  if (sampleCount == null || sampleCount < 5 || firstT == null || lastT == null || latest == null) return null;
  const spanMs = lastT - firstT;
  if (spanMs < 15 * 60_000 || [xMean, yMean, xyMean, xxMean].some((value) => value == null)) return null;
  const covariance = xyMean - xMean * yMean;
  const variance = xxMean - xMean * xMean;
  if (!Number.isFinite(variance) || variance <= 0) return null;
  const ratePerHour = covariance / variance;
  if (!Number.isFinite(ratePerHour) || ratePerHour <= 0) return null;
  return {
    latest,
    ratePerHour,
    sampleCount,
    spanHours: spanMs / 3_600_000,
  };
}

function predictionFromModel(model, goal, now) {
  if (!model || !goal || goal <= 0) return null;
  const remaining = Math.max(0, goal - model.latest);
  return {
    goal,
    eta: remaining === 0 ? now : now + (remaining / model.ratePerHour) * 3_600_000,
    rate_per_hour: model.ratePerHour,
    remaining,
    sample_count: model.sampleCount,
    span_hours: model.spanHours,
  };
}

export function linearRegressionPrediction(rows, goal, now = Date.now()) {
  return predictionFromModel(linearRegressionModel(rows), num(goal), now);
}

export function linearRegressionPredictionFromAggregate(row, goal, now = Date.now()) {
  return predictionFromModel(aggregateRegressionModel(row), num(goal), now);
}

export function linearRegressionPredictions(rows, goals, now = Date.now()) {
  const model = linearRegressionModel(rows);
  return (Array.isArray(goals) ? goals : [])
    .map((goal) => predictionFromModel(model, num(goal), now))
    .filter(Boolean);
}

export function linearRegressionPredictionsFromAggregate(row, goals, now = Date.now()) {
  const model = aggregateRegressionModel(row);
  return (Array.isArray(goals) ? goals : [])
    .map((goal) => predictionFromModel(model, num(goal), now))
    .filter(Boolean);
}

export function dashboardGoalTargets(current, configuredGoal, {
  step = ROUND_GOAL_STEP,
  count = ROUND_GOAL_COUNT,
} = {}) {
  const currentValue = num(current);
  const configured = num(configuredGoal);
  const targets = new Set();
  if (configured != null && configured > 0) targets.add(configured);
  if (currentValue == null || currentValue < 0 || step <= 0 || count <= 0) {
    return [...targets].sort((left, right) => left - right);
  }
  const firstRoundGoal = Math.floor(currentValue / step + 1) * step;
  for (let index = 0; index < count; index += 1) targets.add(firstRoundGoal + index * step);
  return [...targets].sort((left, right) => left - right);
}

export function dashboardGoalPredictions({
  rows,
  aggregate,
  current,
  configuredGoal,
  now = Date.now(),
  useAggregate = false,
} = {}) {
  const goals = dashboardGoalTargets(current, configuredGoal);
  const predictions = useAggregate
    ? linearRegressionPredictionsFromAggregate(aggregate, goals, now)
    : linearRegressionPredictions(rows, goals, now);
  const configured = num(configuredGoal);
  return {
    goalPrediction: predictions.find((prediction) => prediction.goal === configured) || null,
    goalPredictions: predictions,
  };
}
