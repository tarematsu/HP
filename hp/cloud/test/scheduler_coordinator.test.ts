import {
  applyD1Migrations,
  env,
  runInDurableObject,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureSystemJobs,
  invalidateSystemJobsCache,
} from "../src/scheduler";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  SCHEDULER_COORDINATOR: DurableObjectNamespace;
};

type AlarmInstance = { alarm(): Promise<void> };
type RuntimeJob = {
  name: string;
  intervalSeconds: number;
  nextRunAt: number;
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
};
type RuntimeEnvelope = { version: number; jobs: RuntimeJob[] };

const RUNTIME_STORAGE_KEY = "scheduler-runtime-v2";
let objectSequence = 0;

function coordinatorStub(): DurableObjectStub {
  const namespace = (env as TestEnv).SCHEDULER_COORDINATOR;
  return namespace.get(namespace.idFromName(`scheduler-test-${objectSequence++}`));
}

async function alarmTime(stub: DurableObjectStub): Promise<number | null> {
  return runInDurableObject(stub, async (_instance, state) => state.storage.getAlarm());
}

async function runtime(stub: DurableObjectStub): Promise<RuntimeEnvelope | undefined> {
  return runInDurableObject(stub, async (_instance, state) =>
    state.storage.get<RuntimeEnvelope>(RUNTIME_STORAGE_KEY));
}

async function runAlarm(stub: DurableObjectStub): Promise<void> {
  await runInDurableObject(stub, async instance => {
    await (instance as AlarmInstance).alarm();
  });
}

async function insertFailingJob(name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO jobs(
       name,interval_seconds,next_run_at,lease_until,last_success_at,last_error,consecutive_failures
     ) VALUES(?1,900,0,NULL,NULL,NULL,0)`,
  ).bind(name).run();
}

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
  invalidateSystemJobsCache(testEnv.DB);
  await ensureSystemJobs(testEnv);
});

describe("SchedulerCoordinator Durable Object", () => {
  it("accepts only internal POST signals", async () => {
    const stub = coordinatorStub();
    const response = await stub.fetch("https://scheduler.internal/ensure");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await alarmTime(stub)).toBeNull();
  });

  it("migrates runtime state while removing retired jobs", async () => {
    const now = Math.floor(Date.now() / 1000);
    const stub = coordinatorStub();
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put<RuntimeEnvelope>(RUNTIME_STORAGE_KEY, {
        version: 4,
        jobs: [
          {
            name: "octopus",
            intervalSeconds: 86_400,
            nextRunAt: now + 86_400,
            lastSuccessAt: now - 3600,
            consecutiveFailures: 2,
            lastError: "rate limited",
          },
          {
            name: "update_check",
            intervalSeconds: 21_600,
            nextRunAt: now + 21_600,
            lastSuccessAt: now - 900,
            consecutiveFailures: 1,
            lastError: "manifest unavailable",
          },
          {
            name: "video_liveness",
            intervalSeconds: 3600,
            nextRunAt: now + 3600,
            lastSuccessAt: null,
            consecutiveFailures: 0,
            lastError: null,
          },
        ],
      });
    });

    expect((await stub.fetch("https://scheduler.internal/ensure", { method: "POST" })).status).toBe(202);
    const stored = await runtime(stub);
    expect(stored?.version).toBe(5);
    expect(stored?.jobs.some(job => job.name === "video_liveness")).toBe(false);
    expect(stored?.jobs.find(job => job.name === "octopus")).toMatchObject({
      intervalSeconds: 43_200,
      consecutiveFailures: 2,
      lastError: "rate limited",
    });
    expect(stored?.jobs.find(job => job.name === "update_check")).toMatchObject({
      intervalSeconds: 1_800,
      consecutiveFailures: 1,
      lastError: "manifest unavailable",
    });
    expect(Number(stored?.jobs.find(job => job.name === "update_check")?.nextRunAt))
      .toBeLessThanOrEqual(now + 1_800);
  });

  it("schedules an alarm for the earliest runtime job", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE jobs SET next_run_at=?1, lease_until=NULL").bind(now + 3600).run();
    await env.DB.prepare("UPDATE jobs SET next_run_at=0 WHERE name='cleanup'").run();
    const stub = coordinatorStub();

    const response = await stub.fetch("https://scheduler.internal/ensure", { method: "POST" });
    expect(response.status).toBe(202);
    const scheduledAt = await alarmTime(stub);
    expect(Number(scheduledAt)).toBeGreaterThan(Date.now());
    expect(Number(scheduledAt)).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("advances successful work only in DO storage", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE jobs SET next_run_at=?1, lease_until=NULL").bind(now + 3600).run();
    await env.DB.prepare("UPDATE jobs SET next_run_at=0 WHERE name='cleanup'").run();
    const before = await env.DB.prepare(
      "SELECT next_run_at,lease_until,last_success_at FROM jobs WHERE name='cleanup'",
    ).first();
    const stub = coordinatorStub();
    await stub.fetch("https://scheduler.internal/ensure", { method: "POST" });
    await runAlarm(stub);

    const after = await env.DB.prepare(
      "SELECT next_run_at,lease_until,last_success_at FROM jobs WHERE name='cleanup'",
    ).first();
    expect(after).toEqual(before);
    const cleanup = (await runtime(stub))?.jobs.find(job => job.name === "cleanup");
    expect(Number(cleanup?.nextRunAt)).toBeGreaterThan(now);
    expect(cleanup?.consecutiveFailures).toBe(0);
  });

  it("advances more than three co-due jobs in one alarm", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE jobs SET next_run_at=?1, lease_until=NULL").bind(now + 3600).run();
    const names = ["unsupported_1", "unsupported_2", "unsupported_3", "unsupported_4", "unsupported_5"];
    for (const name of names) await insertFailingJob(name);
    const stub = coordinatorStub();
    await stub.fetch("https://scheduler.internal/ensure", { method: "POST" });
    await runAlarm(stub);

    const selected = (await runtime(stub))?.jobs.filter(job => names.includes(job.name)) ?? [];
    expect(selected).toHaveLength(names.length);
    expect(selected.every(job => job.nextRunAt > now)).toBe(true);
    expect(selected.every(job => job.consecutiveFailures === 1)).toBe(true);
  });

  it("records only the first failure until recovery", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE jobs SET next_run_at=?1, lease_until=NULL").bind(now + 3600).run();
    await insertFailingJob("unsupported_source");
    const stub = coordinatorStub();
    await stub.fetch("https://scheduler.internal/ensure", { method: "POST" });
    await runAlarm(stub);
    await stub.fetch("https://scheduler.internal/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: ["unsupported_source"] }),
    });
    await runAlarm(stub);

    const events = await env.DB.prepare(
      "SELECT event,COUNT(*) AS count FROM job_events WHERE job_name=?1 GROUP BY event",
    ).bind("unsupported_source").all();
    expect(events.results).toEqual([{ event: "failed", count: 1 }]);
  });

  it("refreshes only the requested job without touching D1", async () => {
    const scheduledAt = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE jobs SET next_run_at=?1, lease_until=NULL").bind(scheduledAt + 3600).run();
    const stub = coordinatorStub();
    await stub.fetch("https://scheduler.internal/ensure", { method: "POST" });
    const before = await env.DB.prepare("SELECT next_run_at FROM jobs WHERE name='weather'").first();

    const response = await stub.fetch("https://scheduler.internal/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: ["weather"] }),
    });
    const after = await env.DB.prepare("SELECT next_run_at FROM jobs WHERE name='weather'").first();
    const stored = await runtime(stub);

    expect(response.status).toBe(202);
    await expect(response.clone().json()).resolves.toMatchObject({ scheduled: true, changed: 1 });
    expect(after).toEqual(before);
    expect(stored?.jobs.filter(job => job.nextRunAt <= Math.floor(Date.now() / 1000)).map(job => job.name))
      .toEqual(["weather"]);
  });
});
