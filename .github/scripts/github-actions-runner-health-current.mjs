import {
  ACTIONS_RUNNER_HEALTH_END,
  ACTIONS_RUNNER_HEALTH_START,
  MAX_ACTIONS_HEALTH_SUMMARY_CHARS,
  actionsRunnerOverall,
  collectActionsRunnerHealth as collectBaseActionsRunnerHealth,
  evaluateActionsRunnerHealth,
  extractActionsRunnerHealthBlock,
  renderActionsRunnerHealthBlock,
  renderActionsRunnerHealthSummary,
  replaceActionsRunnerHealthSection,
} from './github-actions-runner-health.mjs';

export {
  ACTIONS_RUNNER_HEALTH_END,
  ACTIONS_RUNNER_HEALTH_START,
  MAX_ACTIONS_HEALTH_SUMMARY_CHARS,
  actionsRunnerOverall,
  evaluateActionsRunnerHealth,
  extractActionsRunnerHealthBlock,
  renderActionsRunnerHealthBlock,
  renderActionsRunnerHealthSummary,
  replaceActionsRunnerHealthSection,
};

export const ACTIONS_RUNNER_TARGETS = Object.freeze([
  Object.freeze({
    name: 'Pages read models',
    workflow: 'run-pages-read-model-rebuild.yml',
    cadenceMinutes: 30,
    staleAfterMinutes: 75,
    stalledAfterMinutes: 25,
  }),
  Object.freeze({
    name: 'Runtime offline maintenance',
    workflow: 'run-runtime-offline-maintenance.yml',
    cadenceMinutes: 30,
    staleAfterMinutes: 75,
    stalledAfterMinutes: 25,
    ignoreExpectedWorkflowRunSkips: true,
  }),
  Object.freeze({
    name: 'Track metadata repair',
    workflow: 'run-track-metadata-repair.yml',
    cadenceMinutes: 30,
    staleAfterMinutes: 75,
    stalledAfterMinutes: 25,
  }),
  Object.freeze({
    name: 'Local minute facts rebuild',
    workflow: 'run-local-minute-facts-rebuild.yml',
    cadenceMinutes: 15,
    staleAfterMinutes: 60,
    stalledAfterMinutes: 25,
  }),
  Object.freeze({
    name: 'Observability refresh dispatch',
    workflow: 'refresh-cloudflare-observability.yml',
    cadenceMinutes: 60,
    staleAfterMinutes: 150,
    stalledAfterMinutes: 15,
  }),
  Object.freeze({
    name: 'Unified Cloudflare observability',
    workflow: 'sh-observability.yml',
    cadenceMinutes: 60,
    staleAfterMinutes: 150,
    stalledAfterMinutes: 15,
  }),
  Object.freeze({
    name: 'Deployment health publisher',
    workflow: 'publish-github-deployment-health.yml',
    cadenceMinutes: 15,
    staleAfterMinutes: 45,
    stalledAfterMinutes: 10,
  }),
  Object.freeze({
    name: 'Runner health publisher',
    workflow: 'publish-github-actions-runner-health.yml',
    cadenceMinutes: 15,
    staleAfterMinutes: 45,
    stalledAfterMinutes: 10,
  }),
]);

function operationalTimestamp(run) {
  return run?.run_started_at || run?.created_at || run?.updated_at || null;
}

function timestamp(value) {
  const milliseconds = Date.parse(String(value || ''));
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

export function filterCurrentRunnerPublisherRuns(runs, {
  currentRunId = process.env.GITHUB_RUN_ID,
} = {}) {
  const normalizedCurrentRunId = String(currentRunId || '').trim();
  const ordered = [...(Array.isArray(runs) ? runs : [])].sort((left, right) => (
    timestamp(operationalTimestamp(right)) - timestamp(operationalTimestamp(left))
  ));

  return ordered.filter((run, index) => {
    if (normalizedCurrentRunId && String(run?.id ?? '') === normalizedCurrentRunId) {
      return false;
    }

    const supersededCancellation = index > 0
      && run?.status === 'completed'
      && run?.conclusion === 'cancelled';
    return !supersededCancellation;
  });
}

export function collectActionsRunnerHealth(request, {
  now = Date.now(),
  targets = ACTIONS_RUNNER_TARGETS,
  currentRunId = process.env.GITHUB_RUN_ID,
} = {}) {
  const requestWithPublisherFiltering = async (method, path, ...args) => {
    const response = await request(method, path, ...args);
    if (!String(path || '').includes('/actions/workflows/publish-github-actions-runner-health.yml/runs?')) {
      return response;
    }
    return {
      ...response,
      workflow_runs: filterCurrentRunnerPublisherRuns(response?.workflow_runs, { currentRunId }),
    };
  };

  return collectBaseActionsRunnerHealth(requestWithPublisherFiltering, { now, targets });
}
