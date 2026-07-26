import { sanitizeText } from './observability-status-publisher.mjs';

export const DEPLOYMENT_HEALTH_START = '<!-- github-deployment-health:start -->';
export const DEPLOYMENT_HEALTH_END = '<!-- github-deployment-health:end -->';
export const MAX_DEPLOYMENT_HEALTH_SUMMARY_CHARS = 6_000;

export const DEPLOYMENT_WORKFLOWS = Object.freeze([
  Object.freeze({
    name: 'Deploy production',
    workflow: 'deploy-split-pipeline.yml',
    kind: 'stationhead',
  }),
  Object.freeze({
    name: 'Deploy HomePanel Cloud services',
    workflow: 'cloud-deploy.yml',
    kind: 'homepanel',
  }),
]);

const FAILURE_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'startup_failure',
  'stale',
  'timed_out',
]);

function compact(value, maximum = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1))}…`;
}

function cleanLogLine(line) {
  return String(line || '')
    .replace(/^\ufeff/, '')
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+/, '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^##\[(?:group|endgroup|command|debug)\]/i, '')
    .trim();
}

export function parseDeploymentTargets(logText) {
  const lines = String(logText || '').split(/\r?\n/).map(cleanLogLine);
  const marker = 'DEPLOYMENT_TARGETS_JSON=';
  const line = lines.find((entry) => entry.includes(marker));
  if (line) {
    const raw = line.slice(line.indexOf(marker) + marker.length).trim();
    try {
      const parsed = JSON.parse(raw);
      return {
        minute_db: Boolean(parsed?.minute_db),
        pages: Boolean(parsed?.pages),
        workers: Array.isArray(parsed?.workers) ? parsed.workers.map(String).filter(Boolean) : [],
        commands: Array.isArray(parsed?.commands) ? parsed.commands.map(String).filter(Boolean) : [],
      };
    } catch {
      // Fall through to the legacy worker-list parser for older runs.
    }
  }

  const normalized = lines.join('\n');
  const workerMatch = normalized.match(/"workers"\s*:\s*\[([\s\S]*?)\]/);
  const workers = workerMatch
    ? [...workerMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
    : [];
  return { minute_db: false, pages: false, workers, commands: [] };
}

export function extractDeploymentError(logText, { maximum = 800 } = {}) {
  const lines = String(logText || '')
    .split(/\r?\n/)
    .map(cleanLogLine)
    .filter(Boolean);
  const preferred = lines.filter((line) => (
    /##\[error\]|::error|\b(?:error|failed|failure|timed out|timeout|exit code)\b/i.test(line)
    && !/^Error: GitHub /i.test(line)
  ));
  const selected = (preferred.length ? preferred : lines.slice(-8))
    .map((line) => line
      .replace(/^##\[error\]/i, '')
      .replace(/^::error(?: title=[^:]*)?::/i, '')
      .trim())
    .filter(Boolean);
  const unique = [...new Set(selected)].slice(-4);
  return compact(sanitizeText(unique.join(' | ')) || 'No error details were available from the job log.', maximum);
}

function jobName(job) {
  return String(job?.name || '').trim();
}

function findJob(jobs, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return (Array.isArray(jobs) ? jobs : []).find((job) => (
    list.some((pattern) => pattern.test(jobName(job)))
  )) || null;
}

function findStep(job, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return (Array.isArray(job?.steps) ? job.steps : []).find((step) => (
    list.some((pattern) => pattern.test(String(step?.name || '').trim()))
  )) || null;
}

function normalizedResult(value) {
  const result = String(value || '').trim().toLowerCase();
  return result || 'unknown';
}

function componentFromJob({ workflow, target, job, error = '', run }) {
  const result = normalizedResult(job?.conclusion || job?.status);
  return {
    workflow,
    target,
    result,
    error: result === 'success' ? '' : error,
    run,
  };
}

function componentFromStep({ workflow, target, job, step, error = '', run }) {
  const stepResult = normalizedResult(step?.conclusion || step?.status);
  const jobResult = normalizedResult(job?.conclusion || job?.status);
  const result = step
    ? stepResult
    : (jobResult === 'success' ? 'unknown' : jobResult);
  return {
    workflow,
    target,
    result,
    error: result === 'success' ? '' : error,
    run,
  };
}

export function summarizeDeploymentRun({ target, run, jobs = [], targets = {}, jobErrors = {} }) {
  const workflow = target.name;
  if (!run) {
    return {
      target,
      run: null,
      overall: 'unknown',
      components: [{ workflow, target: 'workflow', result: 'unknown', error: 'No completed deployment run was found.', run: null }],
    };
  }

  const components = [];
  if (target.kind === 'stationhead') {
    const databaseJob = findJob(jobs, [/Apply MINUTE_DB migrations/i, /minute_db/i]);
    const workersJob = findJob(jobs, [/Deploy affected Workers/i, /^workers$/i]);
    const pagesJob = findJob(jobs, [/Build and deploy Pages/i, /^pages$/i]);

    if (targets.minute_db) {
      components.push(componentFromJob({
        workflow,
        target: 'MINUTE_DB migrations',
        job: databaseJob,
        error: jobErrors[databaseJob?.id] || '',
        run,
      }));
    }

    const workers = Array.isArray(targets.workers) ? targets.workers : [];
    for (const worker of workers) {
      components.push(componentFromJob({
        workflow,
        target: worker,
        job: workersJob,
        error: jobErrors[workersJob?.id] || '',
        run,
      }));
    }

    components.push(componentFromJob({
      workflow,
      target: 'Cloudflare Pages (skrzk)',
      job: pagesJob,
      error: jobErrors[pagesJob?.id] || (normalizedResult(run.conclusion) === 'failure' ? Object.values(jobErrors)[0] || '' : ''),
      run,
    }));

    if (!components.length) {
      const fallbackJob = pagesJob || workersJob || databaseJob;
      components.push(componentFromJob({
        workflow,
        target: 'deployment workflow',
        job: fallbackJob || { conclusion: run.conclusion || run.status },
        error: jobErrors[fallbackJob?.id] || '',
        run,
      }));
    }
  } else if (target.kind === 'homepanel') {
    const deployJob = findJob(jobs, [/^deploy$/i, /Deploy HomePanel/i]) || jobs[0] || null;
    const error = jobErrors[deployJob?.id] || '';
    components.push(componentFromStep({
      workflow,
      target: 'homepanel-video',
      job: deployJob,
      step: findStep(deployJob, [/Deploy private video service/i]),
      error,
      run,
    }));
    components.push(componentFromStep({
      workflow,
      target: 'homepanel-cloud',
      job: deployJob,
      step: findStep(deployJob, [/Deploy HomePanel gateway/i]),
      error,
      run,
    }));
  }

  const results = components.map((component) => component.result);
  const runConclusion = normalizedResult(run.conclusion || run.status);
  const overall = FAILURE_CONCLUSIONS.has(runConclusion)
    ? 'failure'
    : results.every((result) => result === 'success' || result === 'skipped')
      ? 'success'
      : results.some((result) => FAILURE_CONCLUSIONS.has(result))
        ? 'failure'
        : 'degraded';
  return { target, run, overall, components };
}

async function latestCompletedRun(request, workflow) {
  const response = await request(
    'GET',
    `/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=main&per_page=10`,
  );
  return (Array.isArray(response?.workflow_runs) ? response.workflow_runs : [])
    .find((run) => run?.status === 'completed') || null;
}

async function runJobs(request, runId) {
  const response = await request('GET', `/actions/runs/${runId}/jobs?per_page=100`);
  return Array.isArray(response?.jobs) ? response.jobs : [];
}

async function fetchJobLog(repository, token, jobId) {
  if (!jobId) return '';
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/jobs/${jobId}/logs`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'github-deployment-health',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });
  if (!response.ok) return '';
  return response.text();
}

export async function collectDeploymentHealth(request, {
  targets = DEPLOYMENT_WORKFLOWS,
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
} = {}) {
  return Promise.all(targets.map(async (target) => {
    try {
      const run = await latestCompletedRun(request, target.workflow);
      if (!run) return summarizeDeploymentRun({ target, run: null });
      const jobs = await runJobs(request, run.id);
      const logs = new Map();
      const jobsToRead = jobs.filter((job) => (
        FAILURE_CONCLUSIONS.has(normalizedResult(job?.conclusion))
        || (target.kind === 'stationhead' && /Select deployment targets/i.test(jobName(job)))
      ));
      await Promise.all(jobsToRead.map(async (job) => {
        logs.set(job.id, await fetchJobLog(repository, token, job.id));
      }));
      const selectJob = findJob(jobs, [/Select deployment targets/i]);
      const deploymentTargets = target.kind === 'stationhead'
        ? parseDeploymentTargets(logs.get(selectJob?.id) || '')
        : {};
      const jobErrors = {};
      for (const job of jobs) {
        if (FAILURE_CONCLUSIONS.has(normalizedResult(job?.conclusion))) {
          jobErrors[job.id] = extractDeploymentError(logs.get(job.id) || '');
        }
      }
      return summarizeDeploymentRun({ target, run, jobs, targets: deploymentTargets, jobErrors });
    } catch (error) {
      return {
        target,
        run: null,
        overall: 'unknown',
        components: [{
          workflow: target.name,
          target: 'workflow',
          result: 'unknown',
          error: `Deployment API query failed: ${compact(error?.message || error, 400)}`,
          run: null,
        }],
      };
    }
  }));
}

function runLink(run) {
  if (!run) return 'none';
  const label = Number.isFinite(Number(run.run_number)) ? `#${run.run_number}` : `run ${run.id || 'unknown'}`;
  return run.html_url ? `[${label}](${run.html_url})` : label;
}

function shortSha(run) {
  return String(run?.head_sha || 'unknown').slice(0, 12);
}

function completedAt(run) {
  return run?.updated_at || run?.created_at || 'unknown';
}

export function deploymentOverall(results) {
  const values = (Array.isArray(results) ? results : []).map((result) => result.overall);
  if (!values.length || values.some((value) => value === 'failure' || value === 'unknown')) return 'failure';
  if (values.some((value) => value === 'degraded')) return 'degraded';
  return 'success';
}

export function renderDeploymentHealthSummary(results, { generatedAt = new Date().toISOString() } = {}) {
  const components = (Array.isArray(results) ? results : []).flatMap((result) => result.components || []);
  const rows = components.map((component) => (
    `| ${component.workflow} | \`${component.target}\` | **${component.result}** | \`${shortSha(component.run)}\` | ${completedAt(component.run)} | ${runLink(component.run)} |`
  ));
  const failures = components
    .filter((component) => component.result !== 'success')
    .map((component) => `- **${component.workflow} / ${component.target}:** ${component.error || `result=${component.result}`}`);
  return `<a id="github-deployment-health" name="github-deployment-health"></a>
### GitHub deployment health

- **Overall:** ${deploymentOverall(results)}
- **Generated:** ${generatedAt}
- **Signal:** latest completed production deployment workflows on \`main\`

| Workflow | Target | Result | Commit | Completed | Run |
|---|---|---|---|---|---|
${rows.join('\n') || '| - | `none` | **unknown** | `unknown` | unknown | none |'}${failures.length ? `\n\n#### Deployment errors and blocked targets\n\n${failures.join('\n')}` : ''}`;
}

export function renderDeploymentHealthBlock(summary) {
  const content = String(summary || '').trim();
  if (!content) return '';
  return `${DEPLOYMENT_HEALTH_START}\n${content}\n${DEPLOYMENT_HEALTH_END}`;
}

export function extractDeploymentHealthBlock(issueBody) {
  const body = String(issueBody || '');
  const start = body.indexOf(DEPLOYMENT_HEALTH_START);
  const end = start >= 0 ? body.indexOf(DEPLOYMENT_HEALTH_END, start) : -1;
  if (start < 0 || end < 0) return '';
  return body.slice(start, end + DEPLOYMENT_HEALTH_END.length);
}

export function replaceDeploymentHealthSection(issueBody, summary) {
  const body = String(issueBody || '');
  const block = renderDeploymentHealthBlock(summary);
  const existing = extractDeploymentHealthBlock(body);
  if (existing) return body.replace(existing, block);
  for (const anchor of [
    '\n## Immediate triage',
    '\n## Deployment and change context',
    '\n## Detailed diagnostics',
  ]) {
    const index = body.indexOf(anchor);
    if (index >= 0) return `${body.slice(0, index)}\n\n${block}${body.slice(index)}`;
  }
  return `${body.trim()}\n\n${block}\n`;
}
