import collectorApp, {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
} from './buddies-collector-core.js';
import {
  runAlarmCoordinatedBuddiesCollectorScheduled,
} from './buddies-collector-do-entry.js';
import { BuddiesCollectorCoordinator } from './buddies-collector-coordinator-combined.js';
import {
  collectStationheadDailyFollowers,
  isJstMidnightMinute,
} from './stationhead-daily-followers.js';

export {
  BUDDIES_COLLECTOR_CRON,
  BuddiesCollectorCoordinator,
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
};

export function runBuddiesCollectorScheduledWithFollowers(
  controller,
  env,
  ctx,
  dependencies = {},
) {
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();

  // Reuse the already-authenticated Buddies collector once per JST day instead
  // of launching a browser or maintaining a second Stationhead session.
  if (String(controller?.cron || '') === BUDDIES_COLLECTOR_CRON && isJstMidnightMinute(scheduledAt)) {
    const collectFollowers = dependencies.collectFollowers || collectStationheadDailyFollowers;
    const followersTask = Promise.resolve()
      .then(() => collectFollowers(env, scheduledAt))
      .then((result) => {
        console.log(JSON.stringify({
          event: 'stationhead_daily_followers_collected',
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
// the midnight follower snapshot remains independent waitUntil work.
export default {
  ...collectorApp,
  scheduled: runBuddiesCollectorScheduledWithFollowers,
};
