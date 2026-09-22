import collectorApp, {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
} from './buddies-collector-core.js';
import {
  runAlarmCoordinatedBuddiesCollectorScheduled,
} from './buddies-collector-do-entry.js';
import { BuddiesCollectorCoordinator } from './buddies-collector-coordinator-combined.js';
import { runPagesRealtimeReadModelWatchdog } from './pages-realtime-read-model-watchdog.js';

export {
  BUDDIES_COLLECTOR_CRON,
  BuddiesCollectorCoordinator,
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
};

export function runBuddiesCollectorScheduledWithPagesWatchdog(
  controller,
  env,
  ctx,
  dependencies = {},
) {
  const watchdog = dependencies.watchdog || runPagesRealtimeReadModelWatchdog;
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  const watchdogTask = Promise.resolve()
    .then(() => watchdog(env, { scheduledAt }))
    .catch((error) => {
      console.error(JSON.stringify({
        event: 'pages_realtime_read_model_watchdog_failed',
        scheduled_at: scheduledAt,
        error: String(error?.message || error).slice(0, 500),
      }));
    });
  if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(watchdogTask);

  const coordinatedScheduled = dependencies.coordinatedScheduled
    || runAlarmCoordinatedBuddiesCollectorScheduled;
  return coordinatedScheduled(controller, env, ctx, dependencies.coordinator);
}

// Keep collection delegated to the Durable Object. The Pages watchdog runs as
// independent waitUntil work and performs no D1 reads on the healthy path.
export default {
  ...collectorApp,
  scheduled: runBuddiesCollectorScheduledWithPagesWatchdog,
};
