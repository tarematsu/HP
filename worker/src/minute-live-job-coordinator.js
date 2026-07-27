const COORDINATOR_NAME = 'live-v1';
const COORDINATOR_URL = 'https://minute-live-job-coordinator.internal/state';
const DEFAULT_LEASE_MS = 60_000;
const MAX_LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 1_000;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = integer(value);
  if (parsed == null || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function coordinatorStub(namespace) {
  if (typeof namespace?.getByName === 'function') return namespace.getByName(COORDINATOR_NAME);
  if (typeof namespace?.idFromName === 'function' && typeof namespace?.get === 'function') {
    return namespace.get(namespace.idFromName(COORDINATOR_NAME));
  }
  return null;
}

async function coordinatorRequest(env, action, payload = {}) {
  const namespace = env?.MINUTE_LIVE_JOB_COORDINATOR;
  if (!namespace) return undefined;
  const stub = coordinatorStub(namespace);
  if (typeof stub?.fetch !== 'function') {
    throw new Error('minute live job coordinator binding is unusable');
  }
  const response = await stub.fetch(COORDINATOR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`minute live job coordinator HTTP ${response.status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

export async function claimCoordinatedLiveJob(env, trigger, options = {}) {
  const response = await coordinatorRequest(env, 'claim', {
    trigger,
    now: integer(options.now) ?? Date.now(),
    lease_ms: positiveInteger(options.leaseMs, DEFAULT_LEASE_MS, MAX_LEASE_MS),
  });
  return response === undefined ? undefined : (response?.job || null);
}

export async function releaseCoordinatedLiveJobs(env, jobIds, options = {}) {
  const ids = (Array.isArray(jobIds) ? jobIds : [jobIds])
    .map((value) => integer(value))
    .filter((value) => value != null && value > 0);
  if (!ids.length) return { released: 0 };
  const response = await coordinatorRequest(env, 'release', {
    job_ids: ids,
    now: integer(options.now) ?? Date.now(),
  });
  return response === undefined ? undefined : { released: Number(response?.released || 0) };
}

export async function completeCoordinatedLiveJob(env, jobId) {
  const id = integer(jobId);
  if (id == null || id <= 0) return { completed: false };
  const response = await coordinatorRequest(env, 'complete', { job_id: id });
  return response === undefined ? undefined : { completed: response?.completed === true };
}

export class MinuteLiveJobCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  storageKey(jobId) {
    return `live-job:${jobId}`;
  }

  async loadJob(trigger) {
    const db = this.env?.MINUTE_DB;
    if (!db?.prepare) throw new Error('minute live job coordinator MINUTE_DB binding is missing');
    const channelId = integer(trigger?.channel_id);
    const minuteAt = integer(trigger?.minute_at);
    const jobKind = String(trigger?.job_kind || 'live');
    if (channelId == null || minuteAt == null || jobKind !== 'live') return null;
    return db.prepare(`SELECT * FROM sh_minute_fact_jobs
      WHERE channel_id=? AND minute_at=? AND job_kind='live' LIMIT 1`)
      .bind(channelId, minuteAt)
      .first();
  }

  async claim(body = {}) {
    const now = integer(body.now) ?? Date.now();
    const leaseMs = positiveInteger(body.lease_ms, DEFAULT_LEASE_MS, MAX_LEASE_MS);
    const job = await this.loadJob(body.trigger);
    if (!job || ['done', 'dead'].includes(String(job.status || ''))) return { job: null };
    if (Number(job.next_attempt_at || 0) > now) return { job: null };
    if (String(job.status || '') === 'processing' && Number(job.lease_until || 0) >= now) {
      return { job: null };
    }

    const jobId = positiveInteger(job.id, null);
    if (jobId == null) return { job: null };
    const key = this.storageKey(jobId);
    const current = await this.state.storage.get(key);
    if (current && Number(current.lease_until || 0) >= now) return { job: null };
    const attempts = Math.min(
      MAX_ATTEMPTS,
      Math.max(Number(job.attempts || 0), Number(current?.attempts || 0)) + 1,
    );
    const leaseUntil = now + leaseMs;
    await this.state.storage.put(key, {
      job_id: jobId,
      attempts,
      claimed_at: now,
      lease_until: leaseUntil,
    });
    return {
      job: {
        ...job,
        status: 'processing',
        attempts,
        lease_until: leaseUntil,
      },
    };
  }

  async release(body = {}) {
    let released = 0;
    for (const jobId of Array.isArray(body.job_ids) ? body.job_ids : []) {
      const id = positiveInteger(jobId, null);
      if (id == null) continue;
      const key = this.storageKey(id);
      const current = await this.state.storage.get(key);
      if (!current) continue;
      await this.state.storage.delete(key);
      released += 1;
    }
    return { released };
  }

  async complete(body = {}) {
    const jobId = positiveInteger(body.job_id, null);
    if (jobId == null) return { completed: false };
    await this.state.storage.delete(this.storageKey(jobId));
    return { completed: true };
  }

  async fetch(request) {
    if (request?.method !== 'POST') {
      return Response.json({ error: 'method-not-allowed' }, { status: 405 });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid-json' }, { status: 400 });
    }
    if (body?.action === 'claim') return Response.json(await this.claim(body));
    if (body?.action === 'release') return Response.json(await this.release(body));
    if (body?.action === 'complete') return Response.json(await this.complete(body));
    return Response.json({ error: 'invalid-action' }, { status: 400 });
  }
}

export const MINUTE_LIVE_JOB_COORDINATOR = Object.freeze({
  binding: 'MINUTE_LIVE_JOB_COORDINATOR',
  class_name: 'MinuteLiveJobCoordinator',
  coordinator_name: COORDINATOR_NAME,
  default_lease_ms: DEFAULT_LEASE_MS,
});
