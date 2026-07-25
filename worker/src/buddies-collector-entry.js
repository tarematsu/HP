import collectorApp, {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
} from './buddies-collector-core.js';
import { queueAttributedEnv } from './queue-attribution.js';

export {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
};
export {
  BuddiesCollectorCoordinator,
  runAlarmCoordinatedBuddiesCollectorScheduled,
} from './buddies-collector-do-entry.js';

export function runAttributedBuddiesCollectorScheduled(controller, env, ctx, dependencies) {
  return runBuddiesCollectorScheduled(
    controller,
    queueAttributedEnv(env, 'sh-buddies-collector'),
    ctx,
    dependencies,
  );
}

// Production uses the direct scheduled surface to avoid one internal request,
// one alarm invocation, and Durable Object storage operations every minute.
// The coordinator remains exported as an explicit rollback surface.
export default {
  ...collectorApp,
  scheduled: runAttributedBuddiesCollectorScheduled,
};
