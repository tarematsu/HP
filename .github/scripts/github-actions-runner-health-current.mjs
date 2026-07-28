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

export function collectActionsRunnerHealth(request, {
  now = Date.now(),
  targets = ACTIONS_RUNNER_TARGETS,
} = {}) {
  return collectBaseActionsRunnerHealth(request, { now, targets });
}
