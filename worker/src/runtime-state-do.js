import { sanitizeFailureDetail } from './collector-failure.js';

const COORDINATOR_NAME = 'runtime-state-v1';
const COORDINATOR_URL = 'https://runtime-state-coordinator.internal/state';
const INDEX_KEY = 'runtime-state:index';
const STATE_PREFIX = 'runtime-state:task:';
const MAX_TASKS = 64;

function enabled(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function finiteInteger(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.max(0, finiteInteger(value, fallback));
}

function taskName(value) {
  const name = String(value ?? '').trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(name)) {
    throw new Error('minute fact runtime task name is invalid');
  }
  return name;
}

function successFor(outcome, options) {
  if (typeof options?.success === 'boolean') return options.success;
  return outcome?.ok !== false && outcome?.failed !== true && !outcome?.error;
}

function coordinatorStub(namespace) {
  if (typeof namespace?.getByName === 'function') return namespace.getByName(COORDINATOR_NAME);
  if (typeof namespace?.idFromName === 'function' && typeof namespace?.get === 'function') {
    return namespace.get(namespace.idFromName(COORDINATOR_NAME));
  }
  return null;
}

function stateKey(task) {
  return `${STATE_PREFIX}${taskName(task)}`;
}

function normalizedSnapshot(outcome = {}) {
  return {
    processed_count: nonNegativeInteger(outcome.processed ?? outcome.processed_count),
    failed_count: nonNegativeInteger(outcome.failed ?? outcome.failed_count),
    pending_count: nonNegativeInteger(outcome.pending_count),
    processing_count: nonNegativeInteger(outcome.processing_count),
    dead_count: nonNegativeInteger(outcome.dead_count),
    oldest_pending_minute: finiteInteger(outcome.oldest_pending_minute),
  };
}

export function mergeRuntimeState(previous, task, outcome = {}, options = {}) {
  const name = taskName(task);
  const now = finiteInteger(options.now, Date.now());
  const startedAt = finiteInteger(options.startedAt, now);
  const success = successFor(outcome, options);
  const snapshot = normalizedSnapshot(outcome);
  const error = success
    ? null
    : sanitizeFailureDetail(
      outcome?.error?.message || outcome?.error || outcome?.last_error || 'unknown failure',
    ).slice(0, 800);
  const current = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? previous
    : {};
  return {
    task_name: name,
    last_started_at: startedAt,
    last_success_at: success ? now : finiteInteger(current.last_success_at),
    last_failure_at: success ? finiteInteger(current.last_failure_at) : now,
    last_duration_ms: Math.max(0, now - startedAt),
    last_error: error,
    runs_total: nonNegativeInteger(current.runs_total) + 1,
    succeeded_total: nonNegativeInteger(current.succeeded_total) + (success ? 1 : 0),
    failed_total: nonNegativeInteger(current.failed_total) + (success ? 0 : 1),
    processed_total: nonNegativeInteger(current.processed_total) + snapshot.processed_count,
    job_failures_total: nonNegativeInteger(current.job_failures_total) + snapshot.failed_count,
    last_processed_count: snapshot.processed_count,
    last_failed_count: snapshot.failed_count,
    pending_count: snapshot.pending_count,
    processing_count: snapshot.processing_count,
    dead_count: snapshot.dead_count,
    oldest_pending_minute: snapshot.oldest_pending_minute,
    updated_at: now,
    ok: success,
    at: now,
    processed_count: snapshot.processed_count,
    failed_count: snapshot.failed_count,
    error,
  };
}

function publicResult(state) {
  if (!state) return null;
  return {
    task_name: state.task_name,
    ok: state.ok !== false,
    at: state.at ?? state.updated_at,
    processed_count: nonNegativeInteger(state.processed_count ?? state.last_processed_count),
    failed_count: nonNegativeInteger(state.failed_count ?? state.last_failed_count),
    pending_count: nonNegativeInteger(state.pending_count),
    processing_count: nonNegativeInteger(state.processing_count),
    dead_count: nonNegativeInteger(state.dead_count),
    oldest_pending_minute: finiteInteger(state.oldest_pending_minute),
    error: state.error ?? state.last_error ?? null,
  };
}

async function requestCoordinator(env, body) {
  if (!enabled(env?.RUNTIME_STATE_DO_ENABLED, false)) return null;
  const stub = coordinatorStub(env?.RUNTIME_STATE_COORDINATOR);
  if (typeof stub?.fetch !== 'function') return null;
  const response = await stub.fetch(COORDINATOR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response?.ok) {
    const detail = typeof response?.text === 'function' ? await response.text() : '';
    throw new Error(`runtime state coordinator HTTP ${response?.status || 500}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

export async function recordMinuteFactRuntimeStateInDo(env, task, outcome = {}, options = {}) {
  try {
    const wireOutcome = {
      ...(outcome && typeof outcome === 'object' ? outcome : {}),
      ...(outcome?.error ? {
        error: sanitizeFailureDetail(outcome.error?.message || outcome.error).slice(0, 800),
      } : {}),
    };
    const wireOptions = {};
    const now = finiteInteger(options.now);
    const startedAt = finiteInteger(options.startedAt);
    if (now != null) wireOptions.now = now;
    if (startedAt != null) wireOptions.startedAt = startedAt;
    if (typeof options.success === 'boolean') wireOptions.success = options.success;
    const result = await requestCoordinator(env, {
      action: 'record',
      task: taskName(task),
      outcome: wireOutcome,
      options: wireOptions,
    });
    return result ? publicResult(result) : null;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'runtime_state_do_record_failed',
      task: String(task || ''),
      error: String(error?.message || error).slice(0, 500),
    }));
    return null;
  }
}

export async function readMinuteFactRuntimeStateFromDo(env, task = null) {
  try {
    return await requestCoordinator(env, {
      action: 'read',
      task: task == null ? null : taskName(task),
    });
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'runtime_state_do_read_failed',
      task: task == null ? null : String(task),
      error: String(error?.message || error).slice(0, 500),
    }));
    return null;
  }
}

export class RuntimeStateCoordinator {
  constructor(state) {
    this.state = state;
    this.memory = new Map();
    this.index = null;
  }

  async get(key) {
    if (this.memory.has(key)) return this.memory.get(key);
    const storage = this.state?.storage;
    const value = typeof storage?.get === 'function' ? await storage.get(key) : undefined;
    if (value !== undefined) this.memory.set(key, value);
    return value;
  }

  async put(key, value) {
    const storage = this.state?.storage;
    if (typeof storage?.put === 'function') await storage.put(key, value);
    this.memory.set(key, value);
  }

  async taskIndex() {
    if (Array.isArray(this.index)) return this.index;
    const stored = await this.get(INDEX_KEY);
    this.index = Array.isArray(stored)
      ? stored.map((value) => String(value)).filter(Boolean).slice(0, MAX_TASKS)
      : [];
    return this.index;
  }

  async ensureIndexed(task) {
    const index = await this.taskIndex();
    if (index.includes(task)) return;
    if (index.length >= MAX_TASKS) throw new Error('runtime state task limit exceeded');
    this.index = [...index, task].sort();
    await this.put(INDEX_KEY, this.index);
  }

  async record(body = {}) {
    const task = taskName(body.task);
    const key = stateKey(task);
    const next = mergeRuntimeState(await this.get(key), task, body.outcome, body.options);
    await this.put(key, next);
    await this.ensureIndexed(task);
    return next;
  }

  async read(task = null) {
    if (task != null) return (await this.get(stateKey(task))) || null;
    const index = await this.taskIndex();
    if (!index.length) return null;
    const states = await Promise.all(index.map((name) => this.get(stateKey(name))));
    return states.filter(Boolean).sort((left, right) => left.task_name.localeCompare(right.task_name));
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
    if (body?.action === 'record') return Response.json(await this.record(body));
    if (body?.action === 'read') return Response.json(await this.read(body?.task));
    return Response.json({ error: 'invalid-action' }, { status: 400 });
  }
}

export const RUNTIME_STATE_DO = Object.freeze({
  coordinator_name: COORDINATOR_NAME,
  index_key: INDEX_KEY,
  state_prefix: STATE_PREFIX,
  max_tasks: MAX_TASKS,
});
