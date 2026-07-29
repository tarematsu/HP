import { cleanupExpiredData, ensureSystemJobs, type JobRow } from "./scheduler";
import { executeSource, type Env, type SourceResult } from "./sources";
import { updateState } from "./snapshot";
import { fetchStationhead } from "./spotify_source";
import { runStationheadHealthMonitor } from "./stationhead_health";
import { configuredIds, loadSwitchBotSnapshot } from "./switchbot_api";
import { fetchSwitchBotOptimized } from "./switchbot_poll";
import { failSafeSwitchBotState } from "./switchbot_state";
import type { SwitchBotEnv } from "./switchbot_types";
import { runUpdateCheck } from "./update_check";

const RUNTIME_STORAGE_KEY = "scheduler-runtime-v2";
const RUNTIME_VERSION = 5;
const MIN_RETRY_SECONDS = 60;
const MAX_FAILURE_EXPONENT = 4;
const EMPTY_RECHECK_SECONDS = 24 * 60 * 60;
const MAX_RUNTIME_BATCH = 3;
const MAX_RUNTIME_JOBS_PER_ALARM = 32;
const NON_SOURCE_JOBS = new Set<string>(["cleanup", "update_check"]);

interface RuntimeJob {
  name: string;
  intervalSeconds: number;
  nextRunAt: number;
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

interface RuntimeEnvelope {
  version: number;
  jobs: RuntimeJob[];
}

interface JobExecution {
  startedAt: number;
  success: boolean;
  message?: string;
}

interface PendingJobEvent {
  jobName: string;
  occurredAt: number;
  event: "failed" | "recovered";
  detail: string | null;
}

function normalizedInterval(row: JobRow): number {
  return Math.max(MIN_RETRY_SECONDS, Number(row.interval_seconds) || MIN_RETRY_SECONDS);
}

function normalizedJob(row: JobRow, nowSeconds: number): RuntimeJob {
  const configuredNext = Number(row.next_run_at);
  return {
    name: row.name,
    intervalSeconds: normalizedInterval(row),
    nextRunAt: configuredNext > nowSeconds ? configuredNext : nowSeconds,
    lastSuccessAt: row.last_success_at === null ? null : Number(row.last_success_at),
    consecutiveFailures: Math.max(0, Number(row.consecutive_failures) || 0),
    lastError: null,
  };
}

async function configuredJobRows(env: Env, nowSeconds: number): Promise<JobRow[]> {
  await ensureSystemJobs(env, nowSeconds * 1000);
  const result = await env.DB.prepare(
    `SELECT name,interval_seconds,next_run_at,lease_until,last_success_at,consecutive_failures
       FROM jobs ORDER BY name`,
  ).all<JobRow>();
  return result.results ?? [];
}

async function bootstrapRuntime(
  state: DurableObjectState,
  env: Env,
  nowSeconds: number,
): Promise<RuntimeEnvelope> {
  const rows = await configuredJobRows(env, nowSeconds);
  const envelope: RuntimeEnvelope = {
    version: RUNTIME_VERSION,
    jobs: rows.map(row => normalizedJob(row, nowSeconds)),
  };
  await state.storage.put(RUNTIME_STORAGE_KEY, envelope);
  return envelope;
}

async function migrateRuntime(
  state: DurableObjectState,
  env: Env,
  stored: RuntimeEnvelope,
  nowSeconds: number,
): Promise<RuntimeEnvelope> {
  const rows = await configuredJobRows(env, nowSeconds);
  const previousJobs = new Map(stored.jobs.map(job => [job.name, job]));
  const jobs = rows.map(row => {
    const previous = previousJobs.get(row.name);
    if (!previous) return normalizedJob(row, nowSeconds);

    const intervalSeconds = normalizedInterval(row);
    const previousNextRunAt = Number(previous.nextRunAt);
    const previousLastSuccessAt = Number(previous.lastSuccessAt);
    return {
      name: row.name,
      intervalSeconds,
      nextRunAt: Number.isFinite(previousNextRunAt)
        ? Math.max(nowSeconds, Math.min(previousNextRunAt, nowSeconds + intervalSeconds))
        : normalizedJob(row, nowSeconds).nextRunAt,
      lastSuccessAt: previous.lastSuccessAt === null || !Number.isFinite(previousLastSuccessAt)
        ? null
        : previousLastSuccessAt,
      consecutiveFailures: Math.max(0, Number(previous.consecutiveFailures) || 0),
      lastError: typeof previous.lastError === "string" ? previous.lastError : null,
    } satisfies RuntimeJob;
  });
  const envelope: RuntimeEnvelope = { version: RUNTIME_VERSION, jobs };
  await state.storage.put(RUNTIME_STORAGE_KEY, envelope);
  return envelope;
}

async function runtimeEnvelope(
  state: DurableObjectState,
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RuntimeEnvelope> {
  const stored = await state.storage.get<RuntimeEnvelope>(RUNTIME_STORAGE_KEY);
  if (stored && Array.isArray(stored.jobs)) {
    if (stored.version === RUNTIME_VERSION) return stored;
    return migrateRuntime(state, env, stored, nowSeconds);
  }
  return bootstrapRuntime(state, env, nowSeconds);
}

async function recordSourceFailure(env: Env, source: string, error: unknown): Promise<string> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  await updateState(env, { source, payload: null, observedAt: Date.now() }, message);
  return `${source}: ${message}`;
}

async function refreshStationheadMonitor(env: Env): Promise<void> {
  try {
    await updateState(env, await fetchStationhead(env));
  } catch (error) {
    throw new Error(await recordSourceFailure(env, "stationhead", error));
  }
}

async function executeRuntimeJob(env: Env, job: RuntimeJob): Promise<JobExecution> {
  const startedAt = Math.floor(Date.now() / 1000);
  let success = false;
  let message: string | undefined;
  let sourceFailureRecorded = false;
  try {
    if (job.name === "cleanup") await cleanupExpiredData(env);
    else if (job.name === "update_check") await runUpdateCheck(env);
    else if (job.name === "stationhead") {
      sourceFailureRecorded = true;
      await refreshStationheadMonitor(env);
    } else if (job.name === "stationhead_health") {
      await runStationheadHealthMonitor(env);
    } else {
      const result: SourceResult = job.name === "switchbot"
        ? await fetchSwitchBotOptimized(env)
        : await executeSource(job.name, env);
      await updateState(env, result);
    }
    success = true;
  } catch (error) {
    message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
    try {
      if (job.name === "switchbot") {
        const switchbotEnv = env as SwitchBotEnv;
        const now = Date.now();
        const snapshot = await loadSwitchBotSnapshot(switchbotEnv);
        const controlPlugIds = configuredIds(switchbotEnv.SWITCHBOT_CONTROL_PLUG_IDS);
        await updateState(env, {
          source: "switchbot",
          payload: failSafeSwitchBotState(snapshot.state, now, controlPlugIds, message),
          observedAt: now,
        }, undefined, snapshot.row);
      } else if (!NON_SOURCE_JOBS.has(job.name) && !sourceFailureRecorded) {
        await updateState(env, { source: job.name, payload: null, observedAt: Date.now() }, message);
      }
    } catch (stateError) {
      console.error(`Failed to record ${job.name} error state`, stateError instanceof Error
        ? stateError.message
        : String(stateError));
    }
  }
  return { startedAt, success, ...(message === undefined ? {} : { message }) };
}

function transitionEvent(
  job: RuntimeJob,
  execution: JobExecution,
  completedAt: number,
): PendingJobEvent | null {
  if (!execution.success && job.consecutiveFailures === 0) {
    return {
      jobName: job.name,
      occurredAt: completedAt,
      event: "failed",
      detail: execution.message ?? "unknown error",
    };
  }
  if (execution.success && job.consecutiveFailures > 0) {
    return {
      jobName: job.name,
      occurredAt: completedAt,
      event: "recovered",
      detail: null,
    };
  }
  return null;
}

async function recordJobEventsBestEffort(env: Env, events: readonly PendingJobEvent[]): Promise<void> {
  if (!events.length) return;
  const statement = env.DB.prepare(
    `INSERT INTO job_events(job_name,occurred_at,event,detail)
     VALUES(?1,?2,?3,?4)
     ON CONFLICT(job_name,occurred_at,event) DO NOTHING`,
  );
  try {
    await env.DB.batch(events.map(event => statement.bind(
      event.jobName,
      event.occurredAt,
      event.event,
      event.detail,
    )));
  } catch (error) {
    console.error("Failed to record scheduler transition events", error instanceof Error
      ? error.message
      : String(error));
  }
}

function dueJobs(
  envelope: RuntimeEnvelope,
  nowSeconds: number,
  limit = MAX_RUNTIME_JOBS_PER_ALARM,
): RuntimeJob[] {
  return envelope.jobs
    .filter(job => job.nextRunAt <= nowSeconds)
    .sort((left, right) => left.nextRunAt - right.nextRunAt || left.name.localeCompare(right.name))
    .slice(0, Math.max(1, Math.trunc(limit)));
}

function nextCadenceAt(completedAt: number, intervalSeconds: number): number {
  const interval = Math.max(MIN_RETRY_SECONDS, Math.trunc(intervalSeconds));
  return (Math.floor(completedAt / interval) + 1) * interval;
}

async function executeDueJobs(env: Env, jobs: readonly RuntimeJob[]): Promise<JobExecution[]> {
  const executions: JobExecution[] = [];
  for (let offset = 0; offset < jobs.length; offset += MAX_RUNTIME_BATCH) {
    const batch = jobs.slice(offset, offset + MAX_RUNTIME_BATCH);
    executions.push(...await Promise.all(batch.map(job => executeRuntimeJob(env, job))));
  }
  return executions;
}

export async function runtimeNextWakeAt(
  state: DurableObjectState,
  env: Env,
  nowMs = Date.now(),
): Promise<number> {
  const nowSeconds = Math.floor(nowMs / 1000);
  const envelope = await runtimeEnvelope(state, env, nowSeconds);
  let next = Number.POSITIVE_INFINITY;
  for (const job of envelope.jobs) next = Math.min(next, job.nextRunAt);
  return Number.isFinite(next) ? next * 1000 : nowMs + EMPTY_RECHECK_SECONDS * 1000;
}

export async function refreshRuntimeJobs(
  state: DurableObjectState,
  env: Env,
  names?: readonly string[],
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<number> {
  const envelope = await runtimeEnvelope(state, env, nowSeconds);
  const selected = names === undefined ? new Set(envelope.jobs.map(job => job.name)) : new Set(names);
  let changed = 0;
  for (const job of envelope.jobs) {
    if (!selected.has(job.name)) continue;
    if (job.nextRunAt !== nowSeconds) {
      job.nextRunAt = nowSeconds;
      changed += 1;
    }
  }
  if (changed) await state.storage.put(RUNTIME_STORAGE_KEY, envelope);
  return changed;
}

export async function runRuntimeSchedulerTick(
  state: DurableObjectState,
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string[]> {
  const envelope = await runtimeEnvelope(state, env, nowSeconds);
  const jobs = dueJobs(envelope, nowSeconds);
  if (!jobs.length) return [];

  const executionEnv: Env = { ...env };
  delete executionEnv.SCHEDULER_COORDINATOR;
  const executions = await executeDueJobs(executionEnv, jobs);
  const completedAt = Math.floor(Date.now() / 1000);
  const events: PendingJobEvent[] = [];

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    const execution = executions[index]!;
    const event = transitionEvent(job, execution, completedAt);
    if (event) events.push(event);

    if (execution.success) {
      job.nextRunAt = nextCadenceAt(completedAt, job.intervalSeconds);
      job.lastSuccessAt = execution.startedAt;
      job.consecutiveFailures = 0;
      job.lastError = null;
    } else {
      job.consecutiveFailures += 1;
      const retrySeconds = Math.min(
        job.intervalSeconds,
        Math.max(
          MIN_RETRY_SECONDS,
          MIN_RETRY_SECONDS * 2 ** Math.min(MAX_FAILURE_EXPONENT, job.consecutiveFailures - 1),
        ),
      );
      job.nextRunAt = completedAt + retrySeconds;
      job.lastError = execution.message ?? "unknown error";
    }
  }

  await state.storage.put(RUNTIME_STORAGE_KEY, envelope);
  await recordJobEventsBestEffort(env, events);
  return jobs.map(job => job.name);
}

export async function resetRuntimeFromD1(
  state: DurableObjectState,
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<void> {
  await state.storage.delete(RUNTIME_STORAGE_KEY);
  await bootstrapRuntime(state, env, nowSeconds);
}
