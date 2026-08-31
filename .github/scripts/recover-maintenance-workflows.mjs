import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOWS = Object.freeze({
  pages: Object.freeze({ file: 'run-pages-read-model-rebuild.yml', staleAfterMs: 45 * 60_000 }),
  runtime: Object.freeze({ file: 'run-runtime-offline-maintenance.yml', staleAfterMs: 60 * 60_000 }),
  metadata: Object.freeze({ file: 'run-track-metadata-repair.yml', staleAfterMs: 60 * 60_000 }),
  localMinute: Object.freeze({ file: 'run-local-minute-facts-rebuild.yml', staleAfterMs: 45 * 60_000 }),
});

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

function startedAt(run) {
  const timestamp = Date.parse(String(run?.run_started_at || run?.created_at || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function workflowRunState(runs, { now = Date.now(), staleAfterMs } = {}) {
  const latest = [...(Array.isArray(runs) ? runs : [])]
    .map((run) => ({ run, timestamp: startedAt(run) }))
    .filter(({ timestamp }) => timestamp != null)
    .sort((left, right) => right.timestamp - left.timestamp)[0];

  if (!latest) return { state: 'missing', runId: null, ageMs: null };

  const status = String(latest.run.status || '').toLowerCase();
  const conclusion = String(latest.run.conclusion || '').toLowerCase();
  const ageMs = Math.max(0, Number(now) - latest.timestamp);
  const runId = latest.run.id ?? null;

  if (ACTIVE_STATUSES.has(status)) return { state: 'active', runId, ageMs };
  if (conclusion !== 'success') return { state: 'failed', runId, ageMs, conclusion };
  if (ageMs >= staleAfterMs) return { state: 'stale', runId, ageMs };
  return { state: 'fresh', runId, ageMs };
}

function shouldRecover(state) {
  return state === 'missing' || state === 'stale';
}

async function githubRequest(url, { token, method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body == null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${method} ${response.status}: ${text.slice(0, 800)}`);
  }
  return text ? JSON.parse(text) : null;
}

function workflowBase(repository, file) {
  return `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(file)}`;
}

async function listWorkflowRuns(repository, definition, token, request) {
  const base = workflowBase(repository, definition.file);
  const listing = await request(`${base}/runs?branch=main&per_page=20`, { token });
  return listing?.workflow_runs || [];
}

async function dispatchWorkflow(repository, definition, token, request) {
  const base = workflowBase(repository, definition.file);
  await request(`${base}/dispatches`, {
    token,
    method: 'POST',
    body: { ref: 'main' },
  });
}

export async function recoverMaintenanceWorkflows({
  token = process.env.GITHUB_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  now = Date.now(),
  request = githubRequest,
} = {}) {
  if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');

  const entries = await Promise.all(Object.entries(WORKFLOWS).map(async ([key, definition]) => {
    const runs = await listWorkflowRuns(repository, definition, token, request);
    return [key, workflowRunState(runs, { now, staleAfterMs: definition.staleAfterMs })];
  }));
  const states = Object.fromEntries(entries);
  const dispatched = [];

  // Pages recovery already owns missing/stale Pages runs. If Pages is currently
  // active or itself needs recovery, avoid starting Runtime in parallel because
  // a successful Pages completion is already an upstream Runtime trigger.
  if (shouldRecover(states.runtime.state)) {
    if (states.pages.state === 'active' || shouldRecover(states.pages.state)) {
      return {
        ok: true,
        dispatched,
        states,
        reason: 'runtime-waits-for-pages-recovery',
      };
    }
    await dispatchWorkflow(repository, WORKFLOWS.runtime, token, request);
    dispatched.push('runtime');
    return { ok: true, dispatched, states, reason: 'runtime-recovered' };
  }

  // Never pile work onto an active Runtime run or work around a real Runtime
  // failure. Those states must remain visible to observability.
  if (states.runtime.state !== 'fresh') {
    return { ok: true, dispatched, states, reason: `runtime-${states.runtime.state}` };
  }

  for (const key of ['metadata', 'localMinute']) {
    if (!shouldRecover(states[key].state)) continue;
    await dispatchWorkflow(repository, WORKFLOWS[key], token, request);
    dispatched.push(key);
  }

  return {
    ok: true,
    dispatched,
    states,
    reason: dispatched.length ? 'downstream-recovered' : 'maintenance-fresh-or-visible',
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await recoverMaintenanceWorkflows();
  console.log(JSON.stringify({ event: 'maintenance_workflow_recovery', ...result }));
}
