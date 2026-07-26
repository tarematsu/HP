import {
  RuntimeCoordinator as StoredRuntimeCoordinator,
  runCoreQueue,
  runCoreScheduled,
} from './runtime-orchestrator-entry.js';
import {
  attributedRuntimeEnv,
  runBudgetedCoreScheduled,
} from './runtime-budgeted-entry.js';
import {
  MINUTE_FACT_REPAIR_BURST_COMPLETE_KEY,
  MINUTE_FACT_REPAIR_BURST_MESSAGE,
  minuteFactRepairBurstEnabled,
  runMinuteFactRepairBurst,
} from './minute-fact-repair-burst.js';

const RUNTIME_COORDINATOR_NAME = 'scheduled-v1';
const DEFAULT_COORDINATOR_LEASE_MS = 70_000;
const MIN_COORDINATOR_LEASE_MS = 30_000;
const MAX_COORDINATOR_LEASE_MS = 180_000;
const COORDINATOR_URL = 'https://runtime-coordinator.internal/run';
const JSON_QUEUE_SEND_OPTIONS = Object.freeze({ contentType: 'json' });
const RETRY_30_SECONDS = Object.freeze({ delaySeconds: 30 });
const MINUTE_MS = 60_000;
const DEFAULT_REPAIR_BURST_INTERVAL_MINUTES = 60;
const MIN_REPAIR_BURST_INTERVAL_MINUTES = 15;
const MAX_REPAIR_BURST_INTERVAL_MINUTES = 24 * 60;
const REPAIR_BURST_OFFSET_MINUTE = 12;
const DEFAULT_DIRECT_RUN_ATTEMPTS = 2;

function enabled(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function minuteFactRepairBurstDue(controller, env = {}) {
  const scheduledAt = Number(controller?.scheduledTime);
  const minuteIndex = Math.floor(
    (Number.isFinite(scheduledAt) ? scheduledAt : Date.now()) / MINUTE_MS,
  );
  const interval = Math.max(
    MIN_REPAIR_BURST_INTERVAL_MINUTES,
    positiveInteger(
      env?.MINUTE_FACT_REPAIR_BURST_INTERVAL_MINUTES,
      DEFAULT_REPAIR_BURST_INTERVAL_MINUTES,
      MAX_REPAIR_BURST_INTERVAL_MINUTES,
    ),
  );
  return ((minuteIndex % interval) + interval) % interval === REPAIR_BURST_OFFSET_MINUTE;
}

function coordinatorLeaseMs(value) {
  const parsed = Number(value ?? DEFAULT_COORDINATOR_LEASE_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_COORDINATOR_LEASE_MS;
  return Math.max(
    MIN_COORDINATOR_LEASE_MS,
    Math.min(MAX_COORDINATOR_LEASE_MS, Math.trunc(parsed)),
  );
}

function coordinatorStub(namespace) {
  if (typeof namespace?.getByName === 'function') {
    return namespace.getByName(RUNTIME_COORDINATOR_NAME);
  }
  if (typeof namespace?.idFromName === 'function' && typeof namespace?.get === 'function') {
    return namespace.get(namespace.idFromName(RUNTIME_COORDINATOR_NAME));
  }
  return null;
}

function coordinatorFailure(event, error, detail = {}) {
  console.error(JSON.stringify({
    event,
    ...detail,
    error: String(error?.message || error).slice(0, 500),
  }));
}

async function coordinatorRequest(stub, body) {
  if (typeof stub?.fetch !== 'function') {
    throw new Error('runtime coordinator fetch binding is unavailable');
  }
  const response = await stub.fetch(COORDINATOR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response?.ok) {
    const detail = typeof response?.text === 'function' ? await response.text() : '';
    throw new Error(`runtime coordinator HTTP ${response?.status || 500}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

async function coordinatorDirectRun(stub, body, attempts = DEFAULT_DIRECT_RUN_ATTEMPTS) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await coordinatorRequest(stub, body);
    } catch (error) {
      lastError = error;
      coordinatorFailure('runtime_coordinator_direct_run_attempt_failed', error, { attempt });
    }
  }
  throw lastError || new Error('runtime coordinator direct run failed');
}

export async function runFetchCoordinatedScheduled(controller, env, ctx, dependencies = {}) {
  const direct = dependencies.runDirect || runCoreScheduled;
  const stub = dependencies.stub || coordinatorStub(env?.RUNTIME_COORDINATOR);
  if (typeof stub?.fetch !== 'function') {
    return direct(controller, env, ctx, dependencies.direct);
  }

  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  const request = {
    cron: String(controller?.cron || ''),
    scheduledTime: scheduledAt,
    leaseMs: coordinatorLeaseMs(env?.PRIMARY_RUN_LOCK_TTL_MS),
  };

  if (enabled(env?.RUNTIME_COORDINATOR_DIRECT_RUN_ENABLED, false)) {
    try {
      return await coordinatorDirectRun(stub, { action: 'run', ...request });
    } catch (error) {
      coordinatorFailure('runtime_coordinator_direct_run_failed', error);
      if (!enabled(env?.RUNTIME_COORDINATOR_FAIL_OPEN, false)) throw error;
      return direct(controller, env, ctx, dependencies.direct);
    }
  }

  let claim;
  try {
    claim = await coordinatorRequest(stub, { action: 'claim', ...request });
  } catch (error) {
    coordinatorFailure('runtime_coordinator_claim_failed', error);
    return direct(controller, env, ctx, dependencies.direct);
  }

  if (!claim?.claimed) {
    return { skipped: true, reason: claim?.reason || 'runtime-coordinator-duplicate' };
  }

  const coordinatedEnv = Object.create(env || null);
  Object.defineProperties(coordinatedEnv, {
    PRIMARY_RUN_LOCK_ENABLED: { value: false, enumerable: false },
    MINUTE_FACT_REPAIR_COMPLETE: {
      value: claim.repair_complete === true,
      enumerable: false,
    },
  });

  const result = await direct(controller, coordinatedEnv, ctx, dependencies.direct);
  if (claim.holder_id) {
    try {
      await coordinatorRequest(stub, {
        action: 'release',
        holder_id: claim.holder_id,
      });
    } catch (error) {
      coordinatorFailure('runtime_coordinator_release_failed', error);
    }
  }
  return result;
}

async function skipDedicatedRawCollection() {
  return { skipped: true, reason: 'dedicated-buddies-collector' };
}

async function scheduleMinuteFactRepairBurst(controller, env) {
  if (!minuteFactRepairBurstEnabled(env)) {
    return { skipped: true, reason: 'repair-burst-disabled' };
  }
  if (env?.MINUTE_FACT_REPAIR_COMPLETE === true) {
    return { skipped: true, reason: 'repair-burst-complete' };
  }
  if (!minuteFactRepairBurstDue(controller, env)) {
    return { skipped: true, reason: 'repair-burst-cadence' };
  }
  if (!env?.HOST_MONITOR_QUEUE?.send) {
    throw new Error('HOST_MONITOR_QUEUE binding is missing for minute fact repair burst');
  }
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  await env.HOST_MONITOR_QUEUE.send({
    message_type: MINUTE_FACT_REPAIR_BURST_MESSAGE,
    message_version: 1,
    scheduled_at: scheduledAt,
    producer_worker: 'sh-runtime-orchestrator',
    operation_name: 'minute-fact-repair-burst',
  }, JSON_QUEUE_SEND_OPTIONS);
  return { dispatched: true, scheduled_at: scheduledAt };
}

export async function runRuntimeWork(controller, env, ctx, dependencies = {}) {
  const direct = dependencies.direct || {};
  const runtime = direct.runtime || {};
  const directDependencies = {
    ...direct,
    runtime: {
      ...runtime,
      dispatchRawCollection: runtime.dispatchRawCollection || skipDedicatedRawCollection,
    },
  };
  const core = dependencies.runDirect || runBudgetedCoreScheduled;
  const [result, repairBurst] = await Promise.all([
    core(controller, env, ctx, directDependencies),
    scheduleMinuteFactRepairBurst(controller, env),
  ]);
  return { ...result, repairBurst };
}

export async function runRuntimeOrchestratorScheduled(
  controller,
  env,
  ctx,
  dependencies = {},
) {
  return runFetchCoordinatedScheduled(controller, env, ctx, {
    ...dependencies,
    runDirect: (receivedController, receivedEnv, receivedCtx) => runRuntimeWork(
      receivedController,
      receivedEnv,
      receivedCtx,
      dependencies,
    ),
  });
}

async function markCoordinatorRepairComplete(env, result) {
  if (result?.repair?.complete !== true) return false;
  const stub = coordinatorStub(env?.RUNTIME_COORDINATOR);
  if (typeof stub?.fetch !== 'function') return false;
  try {
    const response = await coordinatorRequest(stub, {
      action: 'repair-complete',
      completed_at: Date.now(),
    });
    return response?.complete === true;
  } catch (error) {
    coordinatorFailure('runtime_coordinator_repair_complete_failed', error);
    return false;
  }
}

async function processRepairBurstMessage(message, env, options = {}) {
  const body = message?.body || {};
  try {
    if (Number(body.message_version) !== 1) {
      throw new Error('unsupported minute fact repair burst version');
    }
    const run = options.runMinuteFactRepairBurst || runMinuteFactRepairBurst;
    const result = await run(env, { now: Number(body.scheduled_at) || Date.now() });
    await markCoordinatorRepairComplete(env, result);
    message.ack();
  } catch (error) {
    console.error(JSON.stringify({
      event: 'minute_fact_repair_burst_failed',
      error: String(error?.message || error).slice(0, 800),
    }));
    message.retry(RETRY_30_SECONDS);
  }
}

export async function runRuntimeOrchestratorQueue(batch, env, ctx, dependencies = {}) {
  const messages = batch?.messages || [];
  const repairMessages = messages.filter(
    (message) => message?.body?.message_type === MINUTE_FACT_REPAIR_BURST_MESSAGE,
  );
  if (!repairMessages.length) {
    const run = dependencies.runCoreQueue || runCoreQueue;
    return run(batch, attributedRuntimeEnv(env), ctx, dependencies.core || {});
  }

  for (const message of repairMessages) {
    await processRepairBurstMessage(message, env, dependencies.repair || {});
  }
  const remaining = messages.filter(
    (message) => message?.body?.message_type !== MINUTE_FACT_REPAIR_BURST_MESSAGE,
  );
  if (remaining.length) {
    const run = dependencies.runCoreQueue || runCoreQueue;
    await run(
      { ...batch, messages: remaining },
      attributedRuntimeEnv(env),
      ctx,
      dependencies.core || {},
    );
  }
}

export class RuntimeCoordinator extends StoredRuntimeCoordinator {
  constructor(state, env, dependencies = {}) {
    super(state);
    this.env = env || {};
    this.dependencies = dependencies;
    this.repairCompletionFallback = null;
  }

  async repairComplete() {
    const storage = this.state?.storage;
    const stored = typeof storage?.get === 'function'
      ? await storage.get(MINUTE_FACT_REPAIR_BURST_COMPLETE_KEY)
      : this.repairCompletionFallback;
    return Boolean(stored?.complete === true || stored === true || stored === '1');
  }

  async markRepairComplete(completedAt = Date.now()) {
    const completed = {
      complete: true,
      completed_at: Number(completedAt) || Date.now(),
    };
    const storage = this.state?.storage;
    if (typeof storage?.put === 'function') {
      await storage.put(MINUTE_FACT_REPAIR_BURST_COMPLETE_KEY, completed);
    }
    this.repairCompletionFallback = completed;
    return completed;
  }

  activeEnv(repairComplete) {
    const active = Object.create(this.env || null);
    Object.defineProperties(active, {
      PRIMARY_RUN_LOCK_ENABLED: { value: false, enumerable: false },
      MINUTE_FACT_REPAIR_COMPLETE: { value: repairComplete === true, enumerable: false },
    });
    return active;
  }

  async runScheduled(body = {}) {
    const controller = {
      cron: String(body?.cron || ''),
      scheduledTime: Number(body?.scheduledTime) || Date.now(),
    };
    const claim = await this.claim({
      ...controller,
      leaseMs: coordinatorLeaseMs(body?.leaseMs),
    });
    if (!claim?.claimed) {
      return { skipped: true, reason: claim?.reason || 'runtime-coordinator-duplicate' };
    }

    try {
      const result = await runRuntimeWork(
        controller,
        this.activeEnv(await this.repairComplete()),
        {},
        this.dependencies,
      );
      await this.release(claim.holder_id);
      return result;
    } catch (error) {
      // Keep the lease until TTL expiry. The failing graph may still be winding
      // down, so a second scheduled request must not overlap it.
      throw error;
    }
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
    if (body?.action === 'run') return Response.json(await this.runScheduled(body));
    if (body?.action === 'claim') {
      const claim = await this.claim(body);
      if (!claim?.claimed) return Response.json(claim);
      return Response.json({
        ...claim,
        repair_complete: await this.repairComplete(),
      });
    }
    if (body?.action === 'release') {
      return Response.json(await this.release(body?.holder_id, body?.released_at));
    }
    if (body?.action === 'repair-complete') {
      return Response.json(await this.markRepairComplete(body?.completed_at));
    }
    return Response.json({ error: 'invalid-action' }, { status: 400 });
  }
}
