import { enqueueChangedHistoryModels, consumeHistoryRefresh } from './history-read-model-refresh.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';
import { collectStationheadFollowers } from './stationhead-followers-worker.js';
import { refreshStationheadLeaderboard, consumeLeaderboardRefresh } from './leaderboard-refresh.js';

export const HISTORY_READ_MODEL_CRON = '* * * * *';
export const STATIONHEAD_FOLLOWERS_CRON = '0 15 * * *';
export const STATIONHEAD_LEADERBOARD_CRON = '17 12 * * 1';
export const SCHEDULED_COLLECTION_JOB_CRONS = Object.freeze([
  HISTORY_READ_MODEL_CRON,
  STATIONHEAD_FOLLOWERS_CRON,
  STATIONHEAD_LEADERBOARD_CRON,
]);

export async function runScheduledCollectionJob(controller, env) {
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  if (controller?.cron === HISTORY_READ_MODEL_CRON) return enqueueChangedHistoryModels(env, scheduledAt);
  if (controller?.cron === STATIONHEAD_FOLLOWERS_CRON) {
    const result = await collectStationheadFollowers(env, scheduledAt);
    console.log(JSON.stringify({ event: 'stationhead-followers-complete', ...result }));
    return result;
  }
  if (controller?.cron === STATIONHEAD_LEADERBOARD_CRON) {
    const result = await refreshStationheadLeaderboard(env, {}, scheduledAt);
    console.log(JSON.stringify({ event: 'stationhead-leaderboard-import-complete', ...result }));
    return result;
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
      HISTORY_READ_MODEL_CRON,
      SCHEDULED_COLLECTION_JOB_CRONS,
    );
    return internal || new Response('Not found', { status: 404 });
  },
};
