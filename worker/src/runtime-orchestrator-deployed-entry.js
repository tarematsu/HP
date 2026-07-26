import baseWorker from './runtime-orchestrator-entry.js';
import { queueAttributedEnv } from './queue-attribution.js';

export async function runRuntimeOrchestratorQueue(batch, env, ctx, dependencies = {}) {
  const run = dependencies.runCoreQueue || baseWorker.queue;
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
