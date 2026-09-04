import baseWorker from './runtime-orchestrator-entry.js';

export { MinuteLiveJobCoordinator } from './minute-live-job-coordinator.js';

let queueAttributionModulePromise;

function loadQueueAttributionModule() {
  queueAttributionModulePromise ||= import('./queue-attribution.js');
  return queueAttributionModulePromise;
}

export async function runRuntimeOrchestratorQueue(batch, env, ctx, dependencies = {}) {
  const run = dependencies.runCoreQueue || baseWorker.queue;
  const { queueAttributedEnv } = await loadQueueAttributionModule();
  return run(
    batch,
    queueAttributedEnv(env, 'sh-runtime-orchestrator'),
    ctx,
    dependencies.core || {},
  );
}

export default {
  fetch: baseWorker.fetch,
  queue: runRuntimeOrchestratorQueue,
};
