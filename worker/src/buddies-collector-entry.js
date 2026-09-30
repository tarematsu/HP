import collectorApp, {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
} from './buddies-collector-core.js';
import {
  runAlarmCoordinatedBuddiesCollectorScheduled,
} from './buddies-collector-do-entry.js';
import { BuddiesCollectorCoordinator } from './buddies-collector-coordinator-combined.js';
import {
  collectStationheadDailyFollowersResilient,
  isJstFollowerCollectionMinute,
} from './stationhead-daily-followers-resilient.js';

const JST_OFFSET_MS = 9 * 60 * 60_000;
const ONE_TIME_FOLLOWER_BACKFILL_DATE = '2026-10-01';

export {
  BUDDIES_COLLECTOR_CRON,
  BuddiesCollectorCoordinator,
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
};

export function isOneTimeFollowerBackfillMinute(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return false;
  const jst = new Date(value + JST_OFFSET_MS);
  const date = `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
  const hour = jst.getUTCHours();
  return date === ONE_TIME_FOLLOWER_BACKFILL_DATE
    && hour >= 2
    && hour < 5
    && jst.getUTCMinutes() !== 0;
}

export function runBuddiesCollectorScheduledWithFollowers(
  controller,
  env,
  ctx,
  dependencies = {},
) {
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  const followerMinute = isJstFollowerCollectionMinute(scheduledAt)
    || isOneTimeFollowerBackfillMinute(scheduledAt);

  // Collect at 00:00 JST and automatically repair a missing daily snapshot at
  // 00:05 / 00:10. On 2026-10-01 only, also allow the next non-hour minute from
  // 02:00-04:59 JST so today's missed snapshot can be backfilled immediately.
  if (String(controller?.cron || '') === BUDDIES_COLLECTOR_CRON && followerMinute) {
    const collectFollowers = dependencies.collectFollowers || collectStationheadDailyFollowersResilient;
    const followersTask = Promise.resolve()
      .then(() => collectFollowers(env, scheduledAt))
      .then((result) => {
        console.log(JSON.stringify({
          event: result?.skipped
            ? 'stationhead_daily_followers_skipped'
            : 'stationhead_daily_followers_collected',
          ...result,
        }));
      })
      .catch((error) => {
        console.error(JSON.stringify({
          event: 'stationhead_daily_followers_failed',
          scheduled_at: scheduledAt,
          error: String(error?.message || error).slice(0, 800),
        }));
      });
    if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(followersTask);
  }

  const coordinatedScheduled = dependencies.coordinatedScheduled
    || runAlarmCoordinatedBuddiesCollectorScheduled;
  return coordinatedScheduled(controller, env, ctx, dependencies.coordinator);
}

// Keep minute collection delegated to the Durable Object. The current-tab Pages
// read model is published directly after each committed live minute fact, while
// the daily follower snapshot remains independent waitUntil work.
export default {
  ...collectorApp,
  scheduled: runBuddiesCollectorScheduledWithFollowers,
};
