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

// Production executes each minute inside one Durable Object request. The
// object serializes collection, exposes completion status to dependent Workers,
// and keeps hot state; D1 remains the history and checkpoint store.
export default {
  ...collectorApp,
  scheduled: runAlarmCoordinatedBuddiesCollectorScheduled,
};
