const MINUTE_MS = 60_000;

export const RECOVERY_WATCHDOG_INTERVAL_MINUTES = 15;
export const RECOVERY_HEADROOM_MINUTES = 30;

function freeze(policy) {
  return Object.freeze({ ...policy });
}

export const WORKFLOW_HEALTH_POLICIES = Object.freeze([
  freeze({
    key: 'pages',
    name: 'Pages read models',
    workflow: 'run-pages-read-model-rebuild.yml',
    cadenceMinutes: 30,
    staleAfterMinutes: 75,
    stalledAfterMinutes: 25,
    recoverBeforeStale: true,
  }),
  freeze({
    key: 'runtime',
    name: 'Runtime offline maintenance',
    workflow: 'run-runtime-offline-maintenance.yml',
    cadenceMinutes: 30,
    staleAfterMinutes: 75,
    stalledAfterMinutes: 25,
    ignoreExpectedWorkflowRunSkips: true,
    recoverBeforeStale: true,
  }),
  freeze({
    key: 'metadata',
    name: 'Track metadata repair',
    workflow: 'run-track-metadata-repair.yml',
    cadenceMinutes: 30,
    staleAfterMinutes: 75,
    stalledAfterMinutes: 25,
    ignoreExpectedWorkflowRunSkips: true,
    recoverBeforeStale: true,
  }),
  freeze({
    key: 'localMinute',
    name: 'Local minute facts rebuild',
    workflow: 'run-local-minute-facts-rebuild.yml',
    cadenceMinutes: 15,
    staleAfterMinutes: 60,
    stalledAfterMinutes: 25,
    ignoreExpectedWorkflowRunSkips: true,
    recoverBeforeStale: true,
  }),
  freeze({
    key: 'observability',
    name: 'Unified Cloudflare observability',
    workflow: 'sh-observability.yml',
    cadenceMinutes: 60,
    staleAfterMinutes: 150,
    stalledAfterMinutes: 15,
    refreshAfterMinutes: 60,
  }),
  freeze({
    key: 'deploymentPublisher',
    name: 'Deployment health publisher',
    workflow: 'publish-github-deployment-health.yml',
    cadenceMinutes: 15,
    staleAfterMinutes: 45,
    stalledAfterMinutes: 10,
    ignoreSupersededCancellations: true,
  }),
  freeze({
    key: 'runnerPublisher',
    name: 'Runner health publisher',
    workflow: 'publish-github-actions-runner-health.yml',
    cadenceMinutes: 15,
    staleAfterMinutes: 45,
    stalledAfterMinutes: 10,
    ignoreSupersededCancellations: true,
  }),
]);

export const WORKFLOW_HEALTH_BY_KEY = Object.freeze(Object.fromEntries(
  WORKFLOW_HEALTH_POLICIES.map((policy) => [policy.key, policy]),
));

export const ACTIONS_RUNNER_TARGETS = Object.freeze(WORKFLOW_HEALTH_POLICIES.map((policy) => {
  const {
    key,
    recoverBeforeStale,
    refreshAfterMinutes,
    ...target
  } = policy;
  return freeze(target);
}));

export function recoveryAfterMs(policy) {
  if (!policy?.recoverBeforeStale) return null;
  const staleAfterMinutes = Number(policy.staleAfterMinutes);
  const recoverAfterMinutes = staleAfterMinutes - RECOVERY_HEADROOM_MINUTES;
  if (!Number.isFinite(recoverAfterMinutes) || recoverAfterMinutes <= 0) {
    throw new Error(`Invalid recovery policy for ${policy?.workflow || policy?.key || 'unknown workflow'}`);
  }
  if (RECOVERY_HEADROOM_MINUTES <= RECOVERY_WATCHDOG_INTERVAL_MINUTES) {
    throw new Error('Recovery headroom must exceed the watchdog polling interval');
  }
  return recoverAfterMinutes * MINUTE_MS;
}

const recoveryEntries = WORKFLOW_HEALTH_POLICIES
  .filter((policy) => policy.recoverBeforeStale)
  .map((policy) => [policy.key, freeze({
    file: policy.workflow,
    recoverAfterMs: recoveryAfterMs(policy),
    healthStaleAfterMs: policy.staleAfterMinutes * MINUTE_MS,
  })]);

const observability = WORKFLOW_HEALTH_BY_KEY.observability;
recoveryEntries.push(['observability', freeze({
  file: observability.workflow,
  recoverAfterMs: observability.refreshAfterMinutes * MINUTE_MS,
  healthStaleAfterMs: observability.staleAfterMinutes * MINUTE_MS,
})]);

export const RECOVERY_WORKFLOWS = Object.freeze(Object.fromEntries(recoveryEntries));
