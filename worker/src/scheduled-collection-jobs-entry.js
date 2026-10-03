import { handleInternalScheduled } from './internal-scheduled-dispatch.js';
import { collectStationheadFollowers } from './stationhead-followers-worker.js';
import { importStationheadLeaderboardFromR2 } from './stationhead-leaderboard-worker.js';

export const STATIONHEAD_FOLLOWERS_CRON = '0 15 * * *';
export const STATIONHEAD_LEADERBOARD_CRON = '17 12 * * 1';
export const SCHEDULED_COLLECTION_JOB_CRONS = Object.freeze([
  STATIONHEAD_FOLLOWERS_CRON,
  STATIONHEAD_LEADERBOARD_CRON,
]);

export async function runScheduledCollectionJob(controller, env) {
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  if (controller?.cron === STATIONHEAD_FOLLOWERS_CRON) {
    const result = await collectStationheadFollowers(env, scheduledAt);
    console.log(JSON.stringify({ event: 'stationhead-followers-complete', ...result }));
    return result;
  }
  if (controller?.cron === STATIONHEAD_LEADERBOARD_CRON) {
    const result = await importStationheadLeaderboardFromR2(env, scheduledAt);
    console.log(JSON.stringify({ event: 'stationhead-leaderboard-import-complete', ...result }));
    return result;
  }
  throw new Error(`unsupported scheduled collection cron: ${controller?.cron || '(empty)'}`);
}

export default {
  async fetch(request, env) {
    const internal = await handleInternalScheduled(
      request,
      env,
      runScheduledCollectionJob,
      STATIONHEAD_FOLLOWERS_CRON,
      SCHEDULED_COLLECTION_JOB_CRONS,
    );
    if (internal) return internal;
    return new Response('Not found', { status: 404 });
  },
};
