import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readState, updateState, updateStateWithStatus } from "../src/snapshot";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(async () => {
  vi.useFakeTimers();
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await env.DB.exec("DROP TRIGGER IF EXISTS skip_redundant_current_state_heartbeat");
});

afterEach(() => vi.useRealTimers());

describe("current_state heartbeat policy", () => {
  it("does not issue an unchanged success heartbeat before six hours", async () => {
    const startedAt = 1_800_000_000_000;
    vi.setSystemTime(startedAt);
    const payload = { temperature: 20 };
    await updateState(env, { source: "weather", observedAt: startedAt, payload });

    vi.setSystemTime(startedAt + 5 * 60 * 60_000);
    await updateState(env, { source: "weather", observedAt: startedAt + 5 * 60 * 60_000, payload });
    expect((await readState(env, "weather"))?.fetched_at).toBe(startedAt);

    vi.setSystemTime(startedAt + 6 * 60 * 60_000);
    await updateState(env, { source: "weather", observedAt: startedAt + 6 * 60 * 60_000, payload });
    expect((await readState(env, "weather"))?.fetched_at).toBe(startedAt + 6 * 60 * 60_000);
  });

  it("does not rewrite an identical error heartbeat before six hours", async () => {
    const startedAt = 1_800_000_000_000;
    vi.setSystemTime(startedAt);
    await updateState(env, { source: "news", observedAt: startedAt, payload: null }, "upstream unavailable");

    vi.setSystemTime(startedAt + 5 * 60 * 60_000);
    await updateState(env, { source: "news", observedAt: startedAt + 5 * 60 * 60_000, payload: null }, "upstream unavailable");
    expect((await readState(env, "news"))?.fetched_at).toBe(startedAt);

    vi.setSystemTime(startedAt + 6 * 60 * 60_000);
    await updateState(env, { source: "news", observedAt: startedAt + 6 * 60 * 60_000, payload: null }, "upstream unavailable");
    expect((await readState(env, "news"))?.fetched_at).toBe(startedAt + 6 * 60 * 60_000);
  });

  it("stores Stationhead health payload and stale status together without timestamp churn", async () => {
    const startedAt = 1_800_000_000_000;
    vi.setSystemTime(startedAt);
    const firstPayload = {
      configured: true,
      reachable: true,
      healthy: false,
      statusCode: 200,
      sampledAt: startedAt,
      lastRunAt: startedAt - 30_000,
      lastSuccessAt: startedAt - 60_000,
      ageMs: 60_000,
      staleAfterMs: 15 * 60_000,
      reason: "Stationhead collection is stale",
      alertConfigured: false,
      alertPending: false,
      recoveryPending: false,
      alertEventKey: null,
    };
    await updateStateWithStatus(
      env,
      { source: "stationhead_health", observedAt: firstPayload.lastSuccessAt, payload: firstPayload },
      "stale",
      firstPayload.reason,
    );
    const first = await readState(env, "stationhead_health");
    expect(first).toMatchObject({
      version: 1,
      fetched_at: startedAt,
      status: "stale",
      error: firstPayload.reason,
    });

    vi.setSystemTime(startedAt + 30 * 60_000);
    const secondPayload = {
      ...firstPayload,
      sampledAt: startedAt + 30 * 60_000,
      lastRunAt: startedAt + 29 * 60_000,
      lastSuccessAt: startedAt + 28 * 60_000,
      ageMs: 2 * 60_000,
    };
    await updateStateWithStatus(
      env,
      { source: "stationhead_health", observedAt: secondPayload.lastSuccessAt, payload: secondPayload },
      "stale",
      secondPayload.reason,
    );
    const second = await readState(env, "stationhead_health");
    expect(second?.version).toBe(first?.version);
    expect(second?.fetched_at).toBe(first?.fetched_at);
    expect(second?.payload).toBe(first?.payload);
  });
});
