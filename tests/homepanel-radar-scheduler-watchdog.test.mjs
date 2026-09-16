import test from 'node:test';

import { expectAll, readSource } from './helpers/source-contract.mjs';

test('unified Cloudflare Cron keeps the HomePanel scheduler alarm alive', () => {
  const unifiedWorker = readSource('hp/cloud/src/unified_worker.js');
  const schedulerCoordinator = readSource('hp/cloud/src/scheduler_coordinator.ts');

  expectAll(unifiedWorker, [
    "import { queueSchedulerWatchdog } from './scheduler_coordinator.ts'",
    'scheduled(controller, env, ctx)',
    'queueSchedulerWatchdog(env, ctx, controller?.scheduledTime)',
    'videoWorker.scheduled(controller, videoRuntimeEnv(env), ctx)',
  ]);
  expectAll(schedulerCoordinator, [
    'const WATCHDOG_THROTTLE_MS = 60 * 60_000',
    'signalCoordinator(env, "/ensure")',
    'async alarm(): Promise<void>',
  ]);
});
