import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { acquireDueJobs, finishJob, requestRefresh } from "../src/scheduler";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await env.DB.prepare("UPDATE jobs SET next_run_at=?1, lease_until=NULL, last_success_at=?2")
    .bind(Math.floor(Date.now() / 1000) + 3600, Math.floor(Date.now() / 1000))
    .run();
});

describe("scheduler refresh and lease ownership", () => {
  it("queues a refresh without releasing the active lease", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE jobs SET next_run_at=?1 WHERE name='weather'").bind(now - 1).run();
    const leased = await acquireDueJobs(env, now);
    const weather = leased.find(job => job.name === "weather");
    expect(weather).toBeTruthy();

    await requestRefresh(env, ["weather"]);
    const duringRun = await env.DB.prepare(
      "SELECT next_run_at,lease_until FROM jobs WHERE name='weather'",
    ).first<{ next_run_at: number; lease_until: number | null }>();
    expect(duringRun?.next_run_at).toBe(0);
    expect(duringRun?.lease_until).toBe(weather?.lease_until);
    expect(await acquireDueJobs(env, now + 1)).toHaveLength(0);

    expect(await finishJob(env, weather!, now, true)).toBe(true);
    const queued = await env.DB.prepare(
      "SELECT next_run_at,lease_until FROM jobs WHERE name='weather'",
    ).first<{ next_run_at: number; lease_until: number | null }>();
    expect(queued).toEqual({ next_run_at: 0, lease_until: null });
    expect((await acquireDueJobs(env, now + 1)).map(job => job.name)).toContain("weather");
  });

  it("does not let a stale runner overwrite a newer lease or append a run log", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE jobs SET next_run_at=?1, last_success_at=NULL WHERE name='weather'").bind(now - 1).run();
    const weather = (await acquireDueJobs(env, now)).find(job => job.name === "weather");
    expect(weather?.lease_until).toBeTruthy();

    const replacementLease = Number(weather!.lease_until) + 60;
    await env.DB.prepare("UPDATE jobs SET lease_until=?1, next_run_at=?2 WHERE name='weather'")
      .bind(replacementLease, now - 1)
      .run();
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM job_runs WHERE job_name='weather'",
    ).first<{ count: number }>();

    expect(await finishJob(env, weather!, now, false, "stale failure")).toBe(false);
    const row = await env.DB.prepare(
      "SELECT next_run_at,lease_until,consecutive_failures FROM jobs WHERE name='weather'",
    ).first<{ next_run_at: number; lease_until: number | null; consecutive_failures: number }>();
    expect(row).toEqual({ next_run_at: now - 1, lease_until: replacementLease, consecutive_failures: 0 });
    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM job_runs WHERE job_name='weather'",
    ).first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
  });

  it("keeps repeated refresh requests idempotent while a job is already queued", async () => {
    await requestRefresh(env, ["weather", "weather", "unknown"]);
    await requestRefresh(env, ["weather"]);
    const row = await env.DB.prepare(
      "SELECT next_run_at,lease_until FROM jobs WHERE name='weather'",
    ).first<{ next_run_at: number; lease_until: number | null }>();
    expect(row).toEqual({ next_run_at: 0, lease_until: null });
  });
});
