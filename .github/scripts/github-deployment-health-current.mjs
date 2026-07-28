import {
  DEPLOYMENT_HEALTH_END,
  DEPLOYMENT_HEALTH_START,
  DEPLOYMENT_RUN_LOOKBACK,
  DEPLOYMENT_WORKFLOWS,
  MAX_DEPLOYMENT_HEALTH_SUMMARY_CHARS,
  STATIONHEAD_TARGETS,
  STATIONHEAD_WORKERS,
  collectDeploymentHealth as collectBaseDeploymentHealth,
  deploymentOverall,
  extractDeploymentError,
  extractDeploymentHealthBlock,
  mergeDeploymentHistory,
  parseDeploymentTargets,
  renderDeploymentHealthBlock,
  renderDeploymentHealthSummary,
  replaceDeploymentHealthSection,
  summarizeDeploymentRun,
  workerDeploymentResults,
} from './github-deployment-health.mjs';

export {
  DEPLOYMENT_HEALTH_END,
  DEPLOYMENT_HEALTH_START,
  DEPLOYMENT_RUN_LOOKBACK,
  DEPLOYMENT_WORKFLOWS,
  MAX_DEPLOYMENT_HEALTH_SUMMARY_CHARS,
  STATIONHEAD_TARGETS,
  STATIONHEAD_WORKERS,
  deploymentOverall,
  extractDeploymentError,
  extractDeploymentHealthBlock,
  mergeDeploymentHistory,
  parseDeploymentTargets,
  renderDeploymentHealthBlock,
  renderDeploymentHealthSummary,
  replaceDeploymentHealthSection,
  summarizeDeploymentRun,
  workerDeploymentResults,
};

const FAILURE_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'startup_failure',
  'stale',
  'timed_out',
]);

function normalized(value) {
  return String(value || '').trim().toLowerCase() || 'unknown';
}

function findStep(job, pattern) {
  return (Array.isArray(job?.steps) ? job.steps : []).find((step) => pattern.test(String(step?.name || '').trim())) || null;
}

async function fetchJobLog(repository, token, jobId) {
  if (!repository || !token || !jobId) return '';
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/jobs/${jobId}/logs`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'github-deployment-health-current',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });
  return response.ok ? response.text() : '';
}

function component({ workflow, target, step, job, error, run }) {
  const result = normalized(step?.conclusion || step?.status || (job ? job.conclusion || job.status : 'unknown'));
  return {
    workflow,
    target,
    result,
    error: result === 'success' ? '' : error || `result=${result}`,
    run,
  };
}

export function summarizeCurrentHomePanelDeployment({ run, jobs = [], jobError = '' }) {
  const target = DEPLOYMENT_WORKFLOWS.find((entry) => entry.kind === 'homepanel') || {
    name: 'Deploy HomePanel Cloud services',
    workflow: 'cloud-deploy.yml',
    kind: 'homepanel',
  };
  if (!run) {
    return {
      target,
      run: null,
      overall: 'unknown',
      components: [{
        workflow: target.name,
        target: 'deployment workflow',
        result: 'unknown',
        error: 'No completed HomePanel deployment run was found.',
        run: null,
      }],
    };
  }

  const job = jobs.find((entry) => /^deploy$/i.test(String(entry?.name || '').trim())) || jobs[0] || null;
  const cloudStep = findStep(job, /^Deploy HomePanel Cloud$/i);
  const retiredDeletionStep = findStep(job, /^Deploy private video service deletion\b.*Delete retired homepanel-video Worker$/i);
  const components = [
    component({
      workflow: target.name,
      target: 'homepanel-cloud',
      step: cloudStep,
      job,
      error: jobError,
      run,
    }),
    component({
      workflow: target.name,
      target: 'retired homepanel-video deletion',
      step: retiredDeletionStep,
      job,
      error: jobError,
      run,
    }),
  ];

  const runResult = normalized(run.conclusion || run.status);
  const stepResults = components.map((entry) => entry.result);
  if (FAILURE_CONCLUSIONS.has(runResult) && !stepResults.some((value) => FAILURE_CONCLUSIONS.has(value))) {
    components.push({
      workflow: target.name,
      target: 'post-deploy verification',
      result: runResult,
      error: jobError || 'The deployment workflow failed after the deployment steps completed.',
      run,
    });
  }

  const values = components.map((entry) => entry.result);
  const overall = FAILURE_CONCLUSIONS.has(runResult) || values.some((value) => FAILURE_CONCLUSIONS.has(value))
    ? 'failure'
    : values.every((value) => value === 'success')
      ? 'success'
      : 'degraded';
  return { target, run, overall, components };
}

async function collectCurrentHomePanelDeployment(request, {
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
} = {}) {
  const target = DEPLOYMENT_WORKFLOWS.find((entry) => entry.kind === 'homepanel');
  try {
    const response = await request(
      'GET',
      `/actions/workflows/${encodeURIComponent(target.workflow)}/runs?branch=main&per_page=${DEPLOYMENT_RUN_LOOKBACK}`,
    );
    const run = (Array.isArray(response?.workflow_runs) ? response.workflow_runs : [])
      .find((entry) => entry?.status === 'completed') || null;
    if (!run) return summarizeCurrentHomePanelDeployment({ run: null });
    const jobsResponse = await request('GET', `/actions/runs/${run.id}/jobs?per_page=100`);
    const jobs = Array.isArray(jobsResponse?.jobs) ? jobsResponse.jobs : [];
    const failedJob = jobs.find((job) => FAILURE_CONCLUSIONS.has(normalized(job?.conclusion))) || null;
    const log = await fetchJobLog(repository, token, failedJob?.id);
    const jobError = failedJob ? extractDeploymentError(log) : '';
    return summarizeCurrentHomePanelDeployment({ run, jobs, jobError });
  } catch (error) {
    return {
      target,
      run: null,
      overall: 'unknown',
      components: [{
        workflow: target.name,
        target: 'deployment workflow',
        result: 'unknown',
        error: `Deployment API query failed: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 400)}`,
        run: null,
      }],
    };
  }
}

export async function collectDeploymentHealth(request, options = {}) {
  const stationheadTarget = DEPLOYMENT_WORKFLOWS.find((entry) => entry.kind === 'stationhead');
  const [stationheadResults, homepanel] = await Promise.all([
    collectBaseDeploymentHealth(request, { ...options, targets: [stationheadTarget] }),
    collectCurrentHomePanelDeployment(request, options),
  ]);
  return [...stationheadResults, homepanel];
}
