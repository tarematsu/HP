import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PAGES_WORKFLOW = 'run-pages-read-model-rebuild.yml';
export const STALE_AFTER_MS = 45 * 60_000;

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

function startedAt(run) {
  const timestamp = Date.parse(String(run?.run_started_at || run?.created_at || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function pagesRecoveryDecision(runs, { now = Date.now(), staleAfterMs = STALE_AFTER_MS } = {}) {
  const latest = [...(Array.isArray(runs) ? runs : [])]
    .map((run) => ({ run, timestamp: startedAt(run) }))
    .filter(({ timestamp }) => timestamp != null)
    .sort((left, right) => right.timestamp - left.timestamp)[0];

  if (!latest) return { dispatch: true, reason: 'no-pages-runs' };

  const status = String(latest.run.status || '').toLowerCase();
  const conclusion = String(latest.run.conclusion || '').toLowerCase();
  const ageMs = Math.max(0, Number(now) - latest.timestamp);

  if (ACTIVE_STATUSES.has(status)) {
    return { dispatch: false, reason: 'pages-run-active', ageMs, runId: latest.run.id ?? null };
  }
  if (conclusion !== 'success') {
    return { dispatch: false, reason: 'latest-pages-run-not-successful', ageMs, runId: latest.run.id ?? null };
  }
  if (ageMs < staleAfterMs) {
    return { dispatch: false, reason: 'pages-run-fresh', ageMs, runId: latest.run.id ?? null };
  }
  return { dispatch: true, reason: 'pages-run-stale', ageMs, runId: latest.run.id ?? null };
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

export async function recoverPagesReadModels({
  token = process.env.GITHUB_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  now = Date.now(),
  request = githubRequest,
} = {}) {
  if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  const workflow = encodeURIComponent(PAGES_WORKFLOW);
  const base = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}`;
  const listing = await request(`${base}/runs?branch=main&per_page=20`, { token });
  const decision = pagesRecoveryDecision(listing?.workflow_runs, { now });
  if (!decision.dispatch) return { ok: true, dispatched: false, ...decision };

  await request(`${base}/dispatches`, {
    token,
    method: 'POST',
    body: { ref: 'main', inputs: { force_all: 'false' } },
  });
  return { ok: true, dispatched: true, ...decision };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await recoverPagesReadModels();
  console.log(JSON.stringify({ event: 'pages_read_model_recovery', ...result }));
}
