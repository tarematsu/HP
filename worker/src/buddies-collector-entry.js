export {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
} from './buddies-collector-core.js';

// Compatibility export for direct coordinator tests and rollback tooling.
// The production scheduled handler no longer routes through this Durable Object.
export { BuddiesCollectorCoordinator } from './buddies-collector-coordinator-combined.js';

export { default } from './buddies-collector-core.js';
