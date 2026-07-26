import { sanitizeText } from './observability-status-publisher.mjs';

export const DEPLOYMENT_HEALTH_START = '<!-- github-deployment-health:start -->';
export const DEPLOYMENT_HEALTH_END = '<!-- github-deployment-health:end -->';
export const MAX_DEPLOYMENT_HEALTH_SUMMARY_CHARS = 6_000;
export const DEPLOYMENT_RUN_LOOKBACK = 30;

export const STATIONHEAD_WORKERS = Object.freeze([
  Object.freeze({ target: 'sh-sakurazaka46jp', command: 'deploy:sakurazaka46jp' }),
  Object.freeze({ target: 'sh-buddies-recovery', command: 'deploy:buddies-recovery' }),
  Object.freeze({ target: 'sh-buddies-collector', command: 'deploy:buddies-collector' }),
  Object.freeze({ target: 'sh-runtime-orchestrator', command: 'deploy:runtime' }),
]);
export const STATIONHEAD_TARGETS = Object.freeze([
  ...STATIONHEAD_WORKERS.map((entry) => entry.target),
  'Cloudflare Pages (skrzk)',
]);

export const DEPLOYMENT_WORKFLOWS = Object.freeze([
  Object.freeze({ name: 'Deploy production', workflow: 'deploy-split-pipeline.yml', kind: 'stationhead' }),
  Object.freeze({ name: 'Deploy HomePanel Cloud services', workflow: 'cloud-deploy.yml', kind: 'homepanel' }),
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
  for (const markerLine of lines.filter((entry) => entry.includes(marker))) {
    try {
      const raw = markerLine.slice(markerLine.indexOf(marker) + marker.length).trim();
      if (!raw.startsWith('{')) continue;
      const parsed = JSON.parse(raw);
      return {
        minute_db: Boolean(parsed?.minute_db),
        pages: Boolean(parsed?.pages),
        workers: Array.isArray(parsed?.workers) ? parsed.workers.map(String).filter(Boolean) : [],
        commands: Array.isArray(parsed?.commands) ? parsed.commands.map(String).filter(Boolean) : [],
      };
    } catch {
      // The shell source itself may contain the marker before the emitted JSON line. Keep scanning.
    }
  }

  const normalized = lines.join('\n');
  const workerMatches = [...normalized.matchAll(/"workers"\s*:\s*\[([\s\S]*?)\]/g)];
  const commandMatches = [...normalized.matchAll(/"commands"\s*:\s*\[([\s\S]*?)\]/g)];
  const workerMatch = workerMatches.at(-1);
  const commandMatch = commandMatches.at(-1);
  return {
    minute_db: false,
    pages: false,
    workers: workerMatch ? [...workerMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [],
    commands: commandMatch ? [...commandMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [],
  };
}

export function extractDeploymentError(logText, { maximum = 800 } = {}) {
  const lines = String(logText || '').split(/\r?\n/).map(cleanLogLine).filter(Boolean);
  const preferred = lines.filter((line) => (
    /##\[error\]|::error|\b(?:error|failed|failure|timed out|timeout|exit code)\b/i.test(line)
    && !/^Error: GitHub /i.test(line)
  ));
  const selected = (preferred.length ? preferred : lines.slice(-8))
    .map((line) => line.replace(/^##\[error\]/i, '').replace(/^::error(?: title=[^:]*)?::/i, '').trim())
    .filter(Boolean);
  const unique = [...new Set(selected)].slice(-4);
  return compact(sanitizeText(unique.join(' | ')) || 'No error details were available from the job log.', maximum);
}

function normalizedResult(value) {
  return String(value || '').trim().toLowerCase() || 'unknown';
}

function jobName(job) {
  return String(job?.name || '').trim();
}

function findJob(jobs, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return (Array.isArray(jobs) ? jobs : []).find((job) => list.some((pattern) => pattern.test(jobName(job)))) || null;
}

function findStep(job, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return (Array.isArray(job?.steps) ? job.steps : []).find((step) => (
    list.some((pattern) => pattern.test(String(step?.name || '').trim()))
  )) || null;
}

function firstFailure(jobErrors) {
  return Object.values(jobErrors || {}).find(Boolean) || '';
}

function componentFromJob({ workflow, target, job, ownError = '', upstreamError = '', run }) {
  const result = normalizedResult(job?.conclusion || job?.status);
  let error = '';
  if (result !== 'success') {
    error = ownError;
    if (!error && result === 'skipped' && upstreamError) error = `Blocked by an upstream deployment failure: ${upstreamError}`;
  }
  return { workflow, target, result, error, run };
}

function componentFromStep({ workflow, target, job, step, error = '', run }) {
  const stepResult = normalizedResult(step?.conclusion || step?.status);
  const jobResult = normalizedResult(job?.conclusion || job?.status);
  const result = step ? stepResult : (jobResult === 'success' ? 'unknown' : jobResult);
  return { workflow, target, result, error: result === 'success' ? '' : error, run };
}

export function workerDeploymentResults(logText, commands = [], jobConclusion = 'unknown') {
  const normalizedCommands = Array.isArray(commands) ? commands.map(String).filter(Boolean) : [];
  const started = String(logText || '')
    .split(/\r?\n/)
    .map(cleanLogLine)
    .map((line) => line.match(/^Deploying\s+(\S+)/i)?.[1] || '')
    .filter(Boolean);
  const result = {};
  if (!started.length) return result;
  const lastStarted = started.at(-1);
  const jobResult = normalizedResult(jobConclusion);
  for (const command of normalizedCommands) {
    if (!started.includes(command)) result[command] = 'skipped';
    else if (jobResult === 'success') result[command] = 'success';
    else if (command === lastStarted) result[command] = jobResult;
    else result[command] = 'success';
  }
  return result;
}

function inferWorkersFromLog(logText) {
  const commands = String(logText || '')
    .split(/\r?\n/)
    .map(cleanLogLine)
    .map((line) => line.match(/^Deploying\s+(\S+)/i)?.[1] || '')
    .filter(Boolean);
  const byCommand = new Map(STATIONHEAD_WORKERS.map((entry) => [entry.command, entry.target]));
  return {
    commands,
    workers: commands.map((command) => byCommand.get(command)).filter(Boolean),
  };
}

export function summarizeDeploymentRun({ target, run, jobs = [], targets = {}, jobErrors = {}, workerResults = {} }) {
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
  const upstreamError = firstFailure(jobErrors);
  if (target.kind === 'stationhead') {
    const databaseJob = findJob(jobs, [/Apply MINUTE_DB migrations/i, /minute_db/i]);
    const workersJob = findJob(jobs, [/Deploy affected Workers/i, /^workers$/i]);
    const pagesJob = findJob(jobs, [/Build and deploy Pages/i, /^pages$/i]);

    if (targets.minute_db) {
      components.push(componentFromJob({
        workflow,
        target: 'MINUTE_DB migrations',
        job: databaseJob,
        ownError: jobErrors[databaseJob?.id] || '',
        upstreamError,
        run,
      }));
    }

    const workers = Array.isArray(targets.workers) ? targets.workers : [];
    const commands = Array.isArray(targets.commands) ? targets.commands : [];
    for (const [index, worker] of workers.entries()) {
      const command = commands[index] || STATIONHEAD_WORKERS.find((entry) => entry.target === worker)?.command || '';
      const component = componentFromJob({
        workflow,
        target: worker,
        job: workersJob,
        ownError: jobErrors[workersJob?.id] || '',
        upstreamError,
        run,
      });
      const workerResult = command ? workerResults[command] : '';
      if (workerResult) {
        component.result = workerResult;
        if (workerResult === 'success') component.error = '';
        else if (workerResult === 'skipped' && component.error) component.error = `Blocked after another Worker deployment failed: ${component.error}`;
      }
      components.push(component);
    }

    const pagesSelected = Boolean(targets.pages)
      || (pagesJob && normalizedResult(pagesJob.conclusion || pagesJob.status) !== 'skipped');
    if (pagesSelected) {
      components.push(componentFromJob({
        workflow,
        target: 'Cloudflare Pages (skrzk)',
        job: pagesJob,
        ownError: jobErrors[pagesJob?.id] || '',
        upstreamError,
        run,
      }));
    }

    if (!components.length && FAILURE_CONCLUSIONS.has(normalizedResult(run.conclusion || run.status))) {
      components.push({
        workflow,
        target: 'deployment workflow',
        result: normalizedResult(run.conclusion || run.status),
        error: upstreamError || 'The workflow failed before deployment targets could be resolved.',
        run,
      });
    }
  } else if (target.kind === 'homepanel') {
    const deployJob = findJob(jobs, [/^deploy$/i, /Deploy HomePanel/i]) || jobs[0] || null;
    const error = jobErrors[deployJob?.id] || upstreamError;
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

export function mergeDeploymentHistory(summaries, expectedTargets = STATIONHEAD_TARGETS) {
  const ordered = Array.isArray(summaries) ? summaries : [];
  const latest = new Map();
  const newestWorkflowFailure = (ordered[0]?.components || [])
    .find((component) => component.target === 'deployment workflow') || null;
  let latestMinuteDb = null;
  for (const summary of ordered) {
    for (const component of summary?.components || []) {
      if (component.target === 'deployment workflow') continue;
      if (component.target === 'MINUTE_DB migrations') {
        if (!latestMinuteDb) latestMinuteDb = component;
        continue;
      }
      if (!latest.has(component.target)) latest.set(component.target, component);
    }
  }
  const components = [];
  if (newestWorkflowFailure) components.push(newestWorkflowFailure);
  if (latestMinuteDb) components.push(latestMinuteDb);
  for (const target of expectedTargets) {
    components.push(latest.get(target) || {
      workflow: 'Deploy production',
      target,
      result: 'unknown',
      error: `No targeted deployment attempt was found in the last ${DEPLOYMENT_RUN_LOOKBACK} completed runs.`,
      run: null,
    });
  }
  const values = components.map((component) => component.result);
  const overall = values.some((value) => FAILURE_CONCLUSIONS.has(value))
    ? 'failure'
    : values.some((value) => value === 'unknown' || value === 'skipped')
      ? 'degraded'
      : 'success';
  return { target: DEPLOYMENT_WORKFLOWS[0], run: ordered[0]?.run || null, overall, components };
}

async function recentCompletedRuns(request, workflow) {
  const response = await request('GET', `/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=main&per_page=${DEPLOYMENT_RUN_LOOKBACK}`);
  return (Array.isArray(response?.workflow_runs) ? response.workflow_runs : [])
    .filter((run) => run?.status === 'completed');
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

async function inspectDeploymentRun(request, target, run, { repository, token }) {
  const jobs = await runJobs(request, run.id);
  const logs = new Map();
  const jobsToRead = jobs.filter((job) => (
    FAILURE_CONCLUSIONS.has(normalizedResult(job?.conclusion))
    || (target.kind === 'stationhead' && /(?:Select deployment targets|Deploy affected Workers)/i.test(jobName(job)))
  ));
  await Promise.all(jobsToRead.map(async (job) => {
    logs.set(job.id, await fetchJobLog(repository, token, job.id));
  }));

  const jobErrors = {};
  for (const job of jobs) {
    if (FAILURE_CONCLUSIONS.has(normalizedResult(job?.conclusion))) {
      jobErrors[job.id] = extractDeploymentError(logs.get(job.id) || '');
    }
  }

  if (target.kind !== 'stationhead') return summarizeDeploymentRun({ target, run, jobs, jobErrors });

  const selectJob = findJob(jobs, [/Select deployment targets/i]);
  const workersJob = findJob(jobs, [/Deploy affected Workers/i, /^workers$/i]);
  const pagesJob = findJob(jobs, [/Build and deploy Pages/i, /^pages$/i]);
  const databaseJob = findJob(jobs, [/Apply MINUTE_DB migrations/i, /minute_db/i]);
  const workerLog = logs.get(workersJob?.id) || '';
  const parsed = parseDeploymentTargets(logs.get(selectJob?.id) || '');
  const inferred = inferWorkersFromLog(workerLog);
  const deploymentTargets = {
    minute_db: parsed.minute_db || Boolean(databaseJob && normalizedResult(databaseJob.conclusion || databaseJob.status) !== 'skipped'),
    pages: parsed.pages || Boolean(pagesJob && normalizedResult(pagesJob.conclusion || pagesJob.status) !== 'skipped'),
    workers: parsed.workers.length ? parsed.workers : inferred.workers,
    commands: parsed.commands.length ? parsed.commands : inferred.commands,
  };
  const workerResults = workerDeploymentResults(
    workerLog,
    deploymentTargets.commands,
    workersJob?.conclusion || workersJob?.status,
  );
  return summarizeDeploymentRun({ target, run, jobs, targets: deploymentTargets, jobErrors, workerResults });
}

export async function collectDeploymentHealth(request, {
  targets = DEPLOYMENT_WORKFLOWS,
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
} = {}) {
  return Promise.all(targets.map(async (target) => {
    try {
      const runs = await recentCompletedRuns(request, target.workflow);
      if (!runs.length) return summarizeDeploymentRun({ target, run: null });
      if (target.kind === 'homepanel') {
        return inspectDeploymentRun(request, target, runs[0], { repository, token });
      }

      const summaries = [];
      const found = new Set();
      for (const run of runs) {
        const summary = await inspectDeploymentRun(request, target, run, { repository, token });
        summaries.push(summary);
        for (const component of summary.components || []) {
          if (STATIONHEAD_TARGETS.includes(component.target)) found.add(component.target);
        }
        if (found.size === STATIONHEAD_TARGETS.length) break;
      }
      return mergeDeploymentHistory(summaries);
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
- **Signal:** latest targeted deployment attempt for every production Pages and Worker target on \`main\`

| Workflow | Target | Result | Commit | Completed | Run |
|---|---|---|---|---|---|
${rows.join('\n') || '| - | `none` | **unknown** | `unknown` | unknown | none |'}${failures.length ? `\n\n#### Deployment errors, skipped, and blocked targets\n\n${failures.join('\n')}` : ''}`;
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
  for (const anchor of ['\n## Immediate triage', '\n## Deployment and change context', '\n## Detailed diagnostics']) {
    const index = body.indexOf(anchor);
    if (index >= 0) return `${body.slice(0, index)}\n\n${block}${body.slice(index)}`;
  }
  return `${body.trim()}\n\n${block}\n`;
}
