import baseWorker from './runtime-orchestrator-entry.js';
import {
  runRuntimeOrchestratorQueue,
  runRuntimeOrchestratorScheduled,
  runRuntimeWork,
  runtimeOrchestratorDue,
} from './runtime-slim-orchestrator.js';

export {
  runRuntimeOrchestratorQueue,
  runRuntimeOrchestratorScheduled,
  runRuntimeWork,
  runtimeOrchestratorDue,
};

export default {
  fetch: baseWorker.fetch,
  queue: runRuntimeOrchestratorQueue,
  scheduled: runRuntimeOrchestratorScheduled,
};
