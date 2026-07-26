import collectorApp, {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
} from './buddies-collector-core.js';
import {
  runAlarmCoordinatedBuddiesCollectorScheduled,
} from './buddies-collector-do-entry.js';
import { BuddiesCollectorCoordinator } from './buddies-collector-coordinator-combined.js';

export {
  BUDDIES_COLLECTOR_CRON,
  BuddiesCollectorCoordinator,
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
};

// Keep the per-minute Cron invocation below the stateless CPU budget by
// delegating collection to the Durable Object. The collector core still owns
// the D1 lease, so duplicate and uncertain executions remain fail-closed.
export default {
  ...collectorApp,
  scheduled: runAlarmCoordinatedBuddiesCollectorScheduled,
};
