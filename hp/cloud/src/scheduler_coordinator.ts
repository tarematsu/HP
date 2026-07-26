import {
  refreshRuntimeJobs,
  runRuntimeSchedulerTick,
  runtimeNextWakeAt,
} from "./scheduler_runtime";
import type { Env } from "./sources";

const COORDINATOR_NAME = "global";
const WATCHDOG_THROTTLE_MS = 24 * 60 * 60_000;
const MIN_ALARM_DELAY_MS = 1_000;
const RECOVERY_ALARM_DELAY_MS = 60_000;

interface SchedulerEnv extends Env {
  SCHEDULER_COORDINATOR?: DurableObjectNamespace;
}

interface WakeRequest {
  names?: unknown;
}

let nextWatchdogAllowedAt = 0;

function namespaceFor(env: Env): DurableObjectNamespace | null {
  return (env as SchedulerEnv).SCHEDULER_COORDINATOR ?? null;
}

function coordinatorStub(env: Env): DurableObjectStub | null {
  const namespace = namespaceFor(env);
  if (!namespace) return null;
  return namespace.get(namespace.idFromName(COORDINATOR_NAME));
}

async function signalCoordinator(
  env: Env,
  path: "/ensure" | "/wake",
  names?: readonly string[],
): Promise<void> {
  const stub = coordinatorStub(env);
  if (!stub) throw new Error("scheduler coordinator binding is unavailable");
  const response = await stub.fetch(`https://scheduler.internal${path}`, names === undefined
    ? { method: "POST" }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
  if (!response.ok) throw new Error(`scheduler coordinator ${path} failed: HTTP ${response.status}`);
}

export function queueSchedulerWatchdog(
  env: Env,
  ctx: ExecutionContext,
  now = Date.now(),
): boolean {
  if (!namespaceFor(env) || now < nextWatchdogAllowedAt) return false;
  nextWatchdogAllowedAt = now + WATCHDOG_THROTTLE_MS;
  ctx.waitUntil(signalCoordinator(env, "/ensure").catch(error => {
    nextWatchdogAllowedAt = 0;
    console.error("Failed to run scheduler watchdog", error instanceof Error ? error.message : String(error));
  }));
  return true;
}

export function queueSchedulerWake(
  env: Env,
  ctx: ExecutionContext,
  names?: readonly string[],
): boolean {
  if (!namespaceFor(env)) return false;
  ctx.waitUntil(signalCoordinator(env, "/wake", names).catch(error => {
    console.error("Failed to wake scheduler alarm", error instanceof Error ? error.message : String(error));
  }));
  return true;
}

export class SchedulerCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private async nextWakeAt(nowMs = Date.now()): Promise<number> {
    const desired = await runtimeNextWakeAt(this.state, this.env, nowMs);
    return Math.max(nowMs + MIN_ALARM_DELAY_MS, desired);
  }

  private async setEarlierAlarm(desiredAt: number): Promise<number> {
    const current = await this.state.storage.getAlarm();
    if (current === null || desiredAt < current) {
      await this.state.storage.setAlarm(desiredAt);
      return desiredAt;
    }
    return current;
  }

  private async scheduleNext(): Promise<number> {
    return this.setEarlierAlarm(await this.nextWakeAt());
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, {
        status: 405,
        headers: { Allow: "POST" },
      });
    }

    const path = new URL(request.url).pathname;
    if (path === "/ensure") {
      return Response.json({ scheduled: true, alarmAt: await this.scheduleNext() }, { status: 202 });
    }
    if (path !== "/wake") return Response.json({ error: "not_found" }, { status: 404 });

    let body: WakeRequest = {};
    try {
      body = await request.json<WakeRequest>();
    } catch {
      body = {};
    }
    const names = Array.isArray(body.names)
      ? body.names.filter((name): name is string => typeof name === "string")
      : undefined;
    const changed = await refreshRuntimeJobs(this.state, this.env, names);
    const alarmAt = await this.setEarlierAlarm(Date.now() + MIN_ALARM_DELAY_MS);
    return Response.json({ scheduled: true, changed, alarmAt }, { status: 202 });
  }

  async alarm(): Promise<void> {
    try {
      await runRuntimeSchedulerTick(this.state, this.env);
    } catch (error) {
      console.error("Scheduler alarm job failed", error instanceof Error ? error.message : String(error));
    }

    try {
      await this.setEarlierAlarm(await this.nextWakeAt());
    } catch (error) {
      console.error("Failed to schedule the next scheduler alarm", error instanceof Error ? error.message : String(error));
      await this.setEarlierAlarm(Date.now() + RECOVERY_ALARM_DELAY_MS);
    }
  }
}
