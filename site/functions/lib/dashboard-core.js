import { publicLatest, compactQueueStatus } from './dashboard-support.mjs';
import { dashboardGoalPredictions } from '../../../packages/sh-shared/dashboard-prediction.mjs';
import { num } from '../lib/api-utils.js';
import { computePlayback, normalizePlaybackTrack } from '../lib/playback.js';
import {
  factsAreFresh,
  loadFactsBaseline,
  loadFactsDashboard,
} from '../lib/dashboard-facts.js';
import { loadPublicReadModels, presentationFromRow, queueFromReadModel } from '../lib/public-read-model.js';
import {
  hostIdentity,
  queueRevision,
  stateFromQueue,
} from '../lib/queue-state.js';

export const PREDICTION_STATE_SQL = `SELECT
  generated_at,source_observed_at,goal,eta,rate_per_hour,remaining,
  sample_count,span_hours,next_refresh_at,last_error,updated_at
FROM sh_stream_goal_prediction_state
WHERE id='stream-goal-24h'
LIMIT 1`;

const cache = { value: null, hasValue: false, expiresAt: 0 };

export async function cachedPrediction(statement, now = Date.now()) {
  if (cache.hasValue && cache.expiresAt > now) return cache.value;
  const value = await statement.first();
  cache.value = value ?? null;
  cache.hasValue = true;
  cache.expiresAt = Date.now() + 60000;
  return cache.value;
}

export function resetPredictionCache() {
  cache.value = null;
  cache.hasValue = false;
  cache.expiresAt = 0;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function predictionFromPersistedState(row, currentGoal) {
  const generatedAt = finite(row?.generated_at);
  const goal = finite(row?.goal);
  const eta = finite(row?.eta);
  const ratePerHour = finite(row?.rate_per_hour);
  const remaining = finite(row?.remaining);
  if (generatedAt == null || generatedAt <= 0) return null;
  if (currentGoal != null && goal != null && currentGoal !== goal) return null;
  if (eta == null || ratePerHour == null || ratePerHour <= 0 || remaining == null) return null;
  return {
    goal,
    eta,
    rate_per_hour: ratePerHour,
    remaining,
    sample_count: finite(row?.sample_count) ?? 0,
    span_hours: finite(row?.span_hours) ?? 0,
    generated_at: generatedAt,
    source_observed_at: finite(row?.source_observed_at),
  };
}

export function selectGoalPrediction(persistedRow, calculatedPrediction, currentGoal) {
  return predictionFromPersistedState(persistedRow, currentGoal)
    || calculatedPrediction
    || null;
}

export function mergeGoalPredictions(calculatedPredictions, selectedPrediction, currentGoal) {
  const predictions = Array.isArray(calculatedPredictions)
    ? calculatedPredictions.map((prediction) => ({ ...prediction }))
    : [];
  const goal = finite(currentGoal);
  if (!selectedPrediction || goal == null) return predictions;

  const selected = { ...selectedPrediction, goal };
  const index = predictions.findIndex((prediction) => finite(prediction?.goal) === goal);
  if (index >= 0) predictions[index] = selected;
  else predictions.unshift(selected);
  return predictions.sort((left, right) => finite(left?.goal) - finite(right?.goal));
}

async function loadPredictionState(db) {
  if (!db) return null;
  try {
    return await cachedPrediction(db.prepare(PREDICTION_STATE_SQL));
  } catch (error) {
    if (/no such table:\s*sh_stream_goal_prediction_state/i.test(String(error?.message || error))) {
      return null;
    }
    throw error;
  }
}

export function queueResponseFields(queueContext) {
  return {
    queue_revision: queueContext.revision
      || queueRevision(queueContext.state, queueContext.hostIdentity),
    queue_unchanged: Boolean(queueContext.unchanged),
  };
}

export function decorateQueueResponse(payload, queueContext) {
  if (!payload?.ok) return payload;
  const result = { ...payload, ...queueResponseFields(queueContext) };
  if (!queueContext.unchanged) return result;
  result.queue = [];
  if (result.queue_status) {
    result.queue_status = {
      ...result.queue_status,
      playing: result.latest?.is_broadcasting !== 0
        && result.latest?.is_broadcasting !== false
        && !result.queue_status.is_paused,
      total_items: queueContext.state?.total_items ?? result.queue_status.total_items ?? 0,
    };
  }
  return result;
}

export async function onRequestGet(context) {
  if (!context.env?.MINUTE_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'MINUTE_DB binding missing' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const url = new URL(context.request.url);
  const queueContext = {
    requestedRevision: url.searchParams.get('queue_revision') || '',
    revision: '',
    state: null,
    hostIdentity: '',
    unchanged: false,
    contextPromise: null,
  };
  const predictionPromise = loadPredictionState(context.env.MINUTE_DB).catch((error) => {
    console.error(error);
    return null;
  });
  const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
  const includeHistory = url.searchParams.get('history') !== '0';
  try {
    const predictionState = await predictionPromise;
    const facts = await loadFactsDashboard(context.env.MINUTE_DB, {
      since,
      includeHistory,
      includePrediction: !predictionState,
    });
    if (!factsAreFresh(facts.latest)) {
      const factsLatestObservedAt = Number(facts.latest?.observed_at || 0) || null;
      return new Response(JSON.stringify({
        ok: false,
        error: 'minute facts read model is stale',
        code: 'MINUTE_FACTS_STALE',
        stale: true,
        stale_reason: 'minute-facts-read-model-lag',
        facts_latest_observed_at: factsLatestObservedAt,
      }), {
        status: 503,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-dashboard-facts-stale': '1',
          ...(factsLatestObservedAt == null
            ? {}
            : { 'x-dashboard-facts-observed-at': String(factsLatestObservedAt) }),
        },
      });
    }
    const models = await loadPublicReadModels(context.env.MINUTE_DB, facts.latest.channel_id);
    const presentation = presentationFromRow(models.presentation);
    const channel = presentation.channel || presentation;
    const station = channel.current_station || presentation.current_station || {};
    const owner = station.owner || presentation.owner || {};
    const streaming = station.streaming_party || presentation.streaming_party || {};
    const latest = { ...presentation, ...presentation.latest, ...facts.latest };
    const goal = latest.stream_goal ?? streaming.stream_goal ?? null;
    const { latestQueue, queue, registeredItems } = queueFromReadModel(models.queue);
    const generatedAt = Date.now();
    const playback = computePlayback(queue, generatedAt);
    const enrichedQueue = queue.map((track, index) => normalizePlaybackTrack(track, index, playback));
    queueContext.state = stateFromQueue(latestQueue, queue);
    if (queueContext.state) queueContext.state.total_items = registeredItems;
    queueContext.hostIdentity = hostIdentity(latest);
    queueContext.revision = queueRevision(queueContext.state, queueContext.hostIdentity);
    queueContext.unchanged = Boolean(queueContext.requestedRevision && queueContext.requestedRevision === queueContext.revision);

    const now = Date.now();
    const shifted = new Date(now + 9 * 3600000);
    const range = (hour) => {
      let currentStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), hour) - 9 * 3600000;
      if (now < currentStart) currentStart -= 86400000;
      return { previousStart: currentStart - 86400000, currentStart };
    };
    const memberRange = range(16);
    const listensRange = range(9);
    const [previousMembers, previousListens] = await Promise.all([
      loadFactsBaseline(context.env.MINUTE_DB, 'total_member_count', facts.latest.host_id, memberRange.previousStart, memberRange.currentStart),
      loadFactsBaseline(context.env.MINUTE_DB, 'total_listens', facts.latest.host_id, listensRange.previousStart, listensRange.currentStart),
    ]);
    const current = num(latest.current_stream_count ?? streaming.current_stream_count ?? latest.total_listens);
    const { goalPrediction, goalPredictions } = dashboardGoalPredictions({
      rows: facts.history,
      aggregate: facts.prediction,
      current,
      configuredGoal: num(goal),
      now: generatedAt,
      useAggregate: since > 0 || !includeHistory,
    });
    const payload = {
      ok: true,
      generated_at: generatedAt,
      metrics_source: 'facts-db',
      storage_source: 'facts-db',
      delta: since > 0,
      history_deferred: since <= 0 && !includeHistory,
      latest_observed_at: latest.observed_at || since,
      latest: publicLatest(latest, channel, station, owner, goal),
      history: facts.history,
      daily_change: {
        host_account_id: latest.host_account_id ?? null,
        host_handle: latest.host_handle ?? null,
        member_baseline_observed_at: previousMembers?.observed_at || null,
        listens_baseline_observed_at: previousListens?.observed_at || null,
        member_cutoff_hour_jst: 16,
        listens_cutoff_hour_jst: 9,
        total_member_count: previousMembers && num(latest.total_member_count) != null && num(previousMembers.total_member_count) != null
          ? num(latest.total_member_count) - num(previousMembers.total_member_count) : null,
        total_listens: previousListens && num(latest.total_listens) != null && num(previousListens.total_listens) != null
          ? num(latest.total_listens) - num(previousListens.total_listens) : null,
      },
      goal_prediction: goalPrediction,
      goal_predictions: goalPredictions,
      queue: queueContext.unchanged ? [] : enrichedQueue,
      queue_status: compactQueueStatus(latestQueue, latest, playback, registeredItems, queue.length),
      ...queueResponseFields(queueContext),
    };
    const currentGoal = finite(payload.latest?.stream_goal);
    const selectedPrediction = selectGoalPrediction(
      predictionState,
      payload.goal_prediction,
      currentGoal,
    );
    payload.goal_prediction = selectedPrediction;
    payload.goal_predictions = mergeGoalPredictions(payload.goal_predictions, selectedPrediction, currentGoal);
    return new Response(JSON.stringify(decorateQueueResponse(payload, queueContext)), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: error?.message || 'dashboard error' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
