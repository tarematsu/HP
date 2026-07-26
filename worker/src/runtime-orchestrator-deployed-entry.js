import baseWorker from './runtime-orchestrator-entry.js';
import { runRuntimeOrchestratorQueue } from './runtime-slim-orchestrator.js';

export { runRuntimeOrchestratorQueue };

export default {
  fetch: baseWorker.fetch,
  queue: runRuntimeOrchestratorQueue,
};
