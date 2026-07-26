import { runCoreQueue } from './runtime-orchestrator-entry.js';
import { attributedRuntimeEnv } from './runtime-budgeted-entry.js';
import { RUNTIME_CRON } from './runtime-scheduled.js';

export function runtimeOrchestratorDue(controller) {
  return String(controller?.cron || '') !== RUNTIME_CRON;
}

export async function runRuntimeWork(controller) {
  return {
    skipped: true,
    reason: 'offline-maintenance-moved-to-actions',
    scheduled_at: Number(controller?.scheduledTime) || Date.now(),
  };
}

export async function runRuntimeOrchestratorScheduled(controller) {
  return runRuntimeWork(controller);
}

export async function runRuntimeOrchestratorQueue(batch, env, ctx, dependencies = {}) {
  const run = dependencies.runCoreQueue || runCoreQueue;
  return run(batch, attributedRuntimeEnv(env), ctx, dependencies.core || {});
}
