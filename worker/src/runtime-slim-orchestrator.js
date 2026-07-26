import { runCoreQueue } from './runtime-orchestrator-entry.js';
import { attributedRuntimeEnv } from './runtime-budgeted-entry.js';

export async function runRuntimeOrchestratorQueue(batch, env, ctx, dependencies = {}) {
  const run = dependencies.runCoreQueue || runCoreQueue;
  return run(batch, attributedRuntimeEnv(env), ctx, dependencies.core || {});
}
