export const ACTIONS_RUNNER_HEALTH_START = '<!-- github-actions-runner-health:start -->';
export const ACTIONS_RUNNER_HEALTH_END = '<!-- github-actions-runner-health:end -->';
export const MAX_ACTIONS_HEALTH_SUMMARY_CHARS = 4_000;

export const ACTIONS_RUNNER_TARGETS = Object.freeze([
  Object.freeze({
    name: 'Pages read models',
    workflow: 'run-pages-read-model-rebuild.yml',
    cadenceMinutes: 15,
    staleAfterMinutes: 40,
    stalledAfterMinutes: 25,
  }),
  Object.freeze({
    name: 'Runtime offline maintenance',
    workflow: 'run-runtime-offline-maintenance.yml',
    cadenceMinutes: 30,
    staleAfterMinutes: 75,
    stalledAfterMinutes: 25,
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

function timestamp(value) {
  const milliseconds = Date.parse(String(value || ''));
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function ageMilliseconds(value, now) {
  const milliseconds = timestamp(value);
  return milliseconds == null ? Number.POSITIVE_INFINITY : Math.max(0, now - milliseconds);
}

function durationMilliseconds(run, now) {
  const started = timestamp(run?.run_started_at || run?.created_at);
  if (started == null) return null;
  const finished = timestamp(run?.updated_at);
  const end = run?.status === 'completed' && finished != null ? finished : now;
  return Math.max(0, end - started);
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'unknown';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatAge(value, now) {
  const milliseconds = ageMilliseconds(value, now);
  if (!Number.isFinite(milliseconds)) return 'never';
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return '<1m ago';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function runLabel(run) {
  if (!run) return 'none';
  const outcome = run.status === 'completed' ? (run.conclusion || 'unknown') : run.status;
  const number = Number.isFinite(Number(run.run_number)) ? `#${run.run_number}` : `run ${run.id || 'unknown'}`;
  return run.html_url ? `[${number}](${run.html_url}) ${outcome}` : `${number} ${outcome}`;
}

function consecutiveFailures(runs) {
  let count = 0;
  for (const run of runs) {
    if (run?.status !== 'completed') continue;
    if (run.conclusion === 'success') break;
    if (FAILURE_CONCLUSIONS.has(String(run.conclusion || ''))) count += 1;
  }
  return count;
}

export function evaluateActionsRunnerHealth(target, runs, { now = Date.now() } = {}) {
  const ordered = [...(Array.isArray(runs) ? runs : [])]
    .sort((left, right) => (timestamp(right?.created_at) ?? 0) - (timestamp(left?.created_at) ?? 0));
  const latest = ordered[0] || null;
  const lastSuccess = ordered.find((run) => run?.status === 'completed' && run?.conclusion === 'success') || null;
  const latestAge = ageMilliseconds(latest?.created_at, now);
  const successAge = ageMilliseconds(lastSuccess?.updated_at || lastSuccess?.created_at, now);
  const staleAfter = Number(target.staleAfterMinutes) * 60_000;
  const stalledAfter = Number(target.stalledAfterMinutes) * 60_000;

  let health = 'unknown';
  let reason = 'No scheduled runs were returned by the Actions API.';

  if (latest) {
    if (latest.status === 'queued' || latest.status === 'in_progress') {
      const runningFor = durationMilliseconds(latest, now);
      if (runningFor != null && runningFor > stalledAfter) {
        health = 'failure';
        reason = `The latest run has remained ${latest.status} for ${formatDuration(runningFor)}.`;
      } else if (successAge <= staleAfter) {
        health = 'running';
        reason = `The latest scheduled run is ${latest.status}; the previous success is still fresh.`;
      } else {
        health = 'degraded';
        reason = `The latest run is ${latest.status}, but no recent successful completion is available.`;
      }
    } else if (latestAge > staleAfter) {
      health = 'stale';
      reason = `No scheduled run has started within ${target.staleAfterMinutes} minutes.`;
    } else if (latest.status === 'completed' && latest.conclusion === 'success') {
      health = 'healthy';
      reason = 'The latest scheduled run completed successfully.';
    } else if (latest.status === 'completed' && latest.conclusion === 'skipped') {
      health = successAge <= staleAfter ? 'degraded' : 'failure';
      reason = 'The latest scheduled run was skipped.';
    } else if (latest.status === 'completed') {
      health = 'failure';
      reason = `The latest scheduled run concluded with ${latest.conclusion || 'unknown'}.`;
    } else {
      health = 'degraded';
      reason = `The latest scheduled run has unexpected status ${latest.status || 'unknown'}.`;
    }
  }

  return {
    ...target,
    health,
    reason,
    latest,
    lastSuccess,
    latestAge,
    successAge,
    durationMs: latest ? durationMilliseconds(latest, now) : null,
    consecutiveFailures: consecutiveFailures(ordered),
  };
}

export async function collectActionsRunnerHealth(request, {
  now = Date.now(),
  targets = ACTIONS_RUNNER_TARGETS,
} = {}) {
  return Promise.all(targets.map(async (target) => {
    try {
      const workflow = encodeURIComponent(target.workflow);
      const response = await request(
        'GET',
        `/actions/workflows/${workflow}/runs?branch=main&event=schedule&per_page=20`,
      );
      return evaluateActionsRunnerHealth(target, response?.workflow_runs, { now });
    } catch (error) {
      return {
        ...target,
        health: 'unknown',
        reason: `Actions API query failed: ${String(error?.message || error).slice(0, 300)}`,
        latest: null,
        lastSuccess: null,
        latestAge: Number.POSITIVE_INFINITY,
        successAge: Number.POSITIVE_INFINITY,
        durationMs: null,
        consecutiveFailures: 0,
      };
    }
  }));
}

export function actionsRunnerOverall(results) {
  const health = (Array.isArray(results) ? results : []).map((result) => result.health);
  if (!health.length || health.some((value) => value === 'failure' || value === 'stale' || value === 'unknown')) {
    return 'failure';
  }
  if (health.some((value) => value === 'degraded')) return 'degraded';
  if (health.some((value) => value === 'running')) return 'running';
  return 'healthy';
}

export function renderActionsRunnerHealthSummary(results, { now = Date.now() } = {}) {
  const rows = (Array.isArray(results) ? results : []).map((result) => {
    const lastRun = `${runLabel(result.latest)} (${formatAge(result.latest?.created_at, now)})`;
    const lastSuccess = result.lastSuccess
      ? `${formatAge(result.lastSuccess.updated_at || result.lastSuccess.created_at, now)}`
      : 'never';
    return `| ${result.name} | **${result.health}** | ${result.cadenceMinutes}m | ${lastRun} | ${lastSuccess} | ${formatDuration(result.durationMs)} | ${result.consecutiveFailures} |`;
  });
  const details = (Array.isArray(results) ? results : [])
    .filter((result) => result.health !== 'healthy')
    .map((result) => `- **${result.name}:** ${result.reason}`);
  return `### GitHub Actions runner health

- **Overall:** ${actionsRunnerOverall(results)}
- **Generated:** ${new Date(now).toISOString()}
- **Signal:** scheduled workflow runs on \`main\` (GitHub-hosted \`ubuntu-latest\`)

| Workflow | Health | Cadence | Last scheduled run | Last success | Duration | Consecutive failures |
|---|---|---:|---|---|---:|---:|
${rows.join('\n') || '| - | **unknown** | - | none | never | unknown | 0 |'}${details.length ? `\n\n${details.join('\n')}` : ''}`;
}

export function renderActionsRunnerHealthBlock(summary) {
  const content = String(summary || '').trim();
  if (!content) return '';
  return `${ACTIONS_RUNNER_HEALTH_START}\n${content}\n${ACTIONS_RUNNER_HEALTH_END}`;
}

export function replaceActionsRunnerHealthSection(issueBody, summary) {
  const body = String(issueBody || '');
  const block = renderActionsRunnerHealthBlock(summary);
  const start = body.indexOf(ACTIONS_RUNNER_HEALTH_START);
  const end = start >= 0 ? body.indexOf(ACTIONS_RUNNER_HEALTH_END, start) : -1;
  if (start >= 0 && end >= 0) {
    return `${body.slice(0, start)}${block}${body.slice(end + ACTIONS_RUNNER_HEALTH_END.length)}`;
  }
  const anchor = '\n### Active Worker deployments';
  const index = body.indexOf(anchor);
  if (index >= 0) return `${body.slice(0, index)}\n\n${block}${body.slice(index)}`;
  return `${body.trim()}\n\n${block}\n`;
}
