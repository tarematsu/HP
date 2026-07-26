import baseWorker from './runtime-orchestrator-entry.js';
import { RuntimeCoordinator } from './runtime-coordinator-combined.js';
import {
  minuteFactRepairBurstDue,
  runFetchCoordinatedScheduled,
  runRuntimeOrchestratorQueue,
  runRuntimeOrchestratorScheduled,
  runRuntimeWork,
  runtimeOrchestratorDue,
} from './runtime-do-orchestrator.js';

export {
  RuntimeCoordinator,
  minuteFactRepairBurstDue,
  runFetchCoordinatedScheduled,
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
