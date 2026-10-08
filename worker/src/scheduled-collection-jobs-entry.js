import { enqueueChangedHistoryModels, consumeHistoryRefresh } from './history-read-model-refresh.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';
import { collectStationheadFollowers } from './stationhead-followers-worker.js';
import { refreshStationheadLeaderboard, consumeLeaderboardRefresh } from './leaderboard-refresh.js';
import {
  HISTORY_READ_MODEL_RECOVERY_CRON,
  STATIONHEAD_FOLLOWERS_CRON,
  STATIONHEAD_LEADERBOARD_CRON,
} from './scheduled-crons.js';

export {
  HISTORY_READ_MODEL_RECOVERY_CRON,
  STATIONHEAD_FOLLOWERS_CRON,
  STATIONHEAD_LEADERBOARD_CRON,
};

export const SCHEDULED_COLLECTION_JOB_CRONS = Object.freeze([
  HISTORY_READ_MODEL_RECOVERY_CRON,
  STATIONHEAD_FOLLOWERS_CRON,
  STATIONHEAD_LEADERBOARD_CRON,
]);

export async function runScheduledCollectionJob(controller, env, dependencies = {}) {
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  const enqueueHistory = dependencies.enqueueHistory || enqueueChangedHistoryModels;
  const collectFollowers = dependencies.collectFollowers || collectStationheadFollowers;
  const refreshLeaderboard = dependencies.refreshLeaderboard || refreshStationheadLeaderboard;
  if (controller?.cron === HISTORY_READ_MODEL_RECOVERY_CRON) {
    return enqueueHistory(env, scheduledAt);
  }
  if (controller?.cron === STATIONHEAD_FOLLOWERS_CRON) {
    const result = await collectFollowers(env, scheduledAt);
    console.log(JSON.stringify({ event: 'stationhead-followers-complete', ...result }));
    return result;
  }
  if (controller?.cron === STATIONHEAD_LEADERBOARD_CRON) {
    const result = await refreshLeaderboard(env, {}, scheduledAt);
    const readModels = await enqueueHistory(env, scheduledAt);
    console.log(JSON.stringify({ event: 'stationhead-leaderboard-import-complete', ...result, read_models_queued: readModels.queued }));
    return { ...result, read_models: readModels };
  }
  throw new Error(`unsupported scheduled collection cron: ${controller?.cron || '(empty)'}`);
}

export default {
  queue(batch, env) {
    if (batch.queue === 'pages-history-refresh') return consumeHistoryRefresh(batch, env);
    if (batch.queue === 'stationhead-leaderboard-refresh') return consumeLeaderboardRefresh(batch, env);
    throw new Error(`unsupported collection queue: ${batch.queue || '(empty)'}`);
  },
  async fetch(request, env) {
    const internal = await handleInternalScheduled(
      request,
      env,
      runScheduledCollectionJob,
      HISTORY_READ_MODEL_RECOVERY_CRON,
      SCHEDULED_COLLECTION_JOB_CRONS,
    );
    return internal || new Response('Not found', { status: 404 });
  },
};
