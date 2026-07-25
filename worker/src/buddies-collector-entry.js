import collectorApp, {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
} from './buddies-collector-core.js';
import {
  BuddiesCollectorCoordinator,
  runAlarmCoordinatedBuddiesCollectorScheduled,
} from './buddies-collector-do-entry.js';

export {
  BUDDIES_COLLECTOR_CRON,
  BuddiesCollectorCoordinator,
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
};

// Production executes each minute inside one Durable Object request. The
// object serializes collection and keeps hot state; D1 remains the history and
// checkpoint store. The direct function remains exported for tests/rollback.
export default {
  ...collectorApp,
  scheduled: runAlarmCoordinatedBuddiesCollectorScheduled,
};
