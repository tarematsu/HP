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
const FOLLOWER_CATCHUP_INTERVAL_MINUTES = 5;

export {
  BUDDIES_COLLECTOR_CRON,
  BuddiesCollectorCoordinator,
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
};

export function isFollowerCatchupMinute(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return false;
  const jst = new Date(value + JST_OFFSET_MS);
  const minute = jst.getUTCMinutes();
  return minute !== 0 && minute % FOLLOWER_CATCHUP_INTERVAL_MINUTES === 0;
}

export function runBuddiesCollectorScheduledWithFollowers(
  controller,
  env,
  ctx,
  dependencies = {},
) {
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  const followerMinute = isJstFollowerCollectionMinute(scheduledAt)
    || isFollowerCatchupMinute(scheduledAt);

  // Collect at 00:00 JST, then allow a lightweight catch-up check every five
  // minutes. The resilient collector checks today's row before any Stationhead
  // requests, so a completed daily snapshot turns later catch-up minutes into a
  // single cheap D1 lookup while a missed snapshot can recover the same day.
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
