import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  OCTOPUS_HISTORY_FLOOR_MS,
  octopusStableCutoffJst,
  synchronizeOctopusHistory,
  type OctopusRange,
  type OctopusReading,
} from "../src/octopus_history";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

function readingInside(range: OctopusRange): OctopusReading {
  return {
    supplyPoint: "spin-1",
    startAt: new Date(range.from.getTime() + 30 * 60_000).toISOString(),
    value: 0.25,
  };
}

describe("Octopus D1 history", () => {
  it("moves the backfill cursor backward and never stores the latest 48 hours", async () => {
    const now = Date.parse("2026-07-10T18:00:00Z");
    const stableCutoff = octopusStableCutoffJst(now);
    expect(new Date(stableCutoff).toISOString()).toBe("2026-07-08T18:00:00.000Z");
    const comparison = {
      from: new Date("2026-06-25T15:00:00.000Z"),
      to: new Date("2026-07-02T15:00:00.000Z"),
    };
    const requested: OctopusRange[] = [];
    const fetchRange = async (range: OctopusRange): Promise<OctopusReading[]> => {
      requested.push(range);
      return [readingInside(range)];
    };

    const first = await synchronizeOctopusHistory(
      env,
      "A-123",
      now,
      "daily-profile:2026-06-26:2026-07-02",
      comparison,
      fetchRange,
    );
    expect(first.completed).toBe(false);
    expect(first.historyFloor).toBe(OCTOPUS_HISTORY_FLOOR_MS);
    expect(first.liveReadings.length).toBeGreaterThan(0);
    expect(first.liveReadings.every(reading => Date.parse(reading.startAt) >= stableCutoff)).toBe(true);

    const stored = await env.DB.prepare(
      "SELECT COUNT(*) AS count,MIN(observed_at) AS oldest,MAX(observed_at) AS latest FROM octopus_readings",
    ).first<{ count: number; oldest: number; latest: number }>();
    expect(Number(stored?.count)).toBeGreaterThan(10);
    expect(Number(stored?.latest)).toBeLessThan(stableCutoff);
    expect(Number(stored?.oldest)).toBeLessThan(stableCutoff - 20 * 86_400_000);
    expect(Number(stored?.oldest)).toBeGreaterThanOrEqual(OCTOPUS_HISTORY_FLOOR_MS);

    const firstCursor = first.cursorBefore;
    requested.length = 0;
    const second = await synchronizeOctopusHistory(
      env,
      "A-123",
      now,
      "daily-profile:2026-06-26:2026-07-02",
      comparison,
      fetchRange,
    );
    expect(second.cursorBefore).toBe(firstCursor - 30 * 86_400_000);
    expect(requested.some(range => range.from.getTime() === comparison.from.getTime())).toBe(false);

    const marked = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM octopus_sync_ranges WHERE account_number=?1 AND range_key=?2",
    ).bind("A-123", "daily-profile:2026-06-26:2026-07-02").first<{ count: number }>();
    expect(marked?.count).toBe(1);
  });

  it("rounds the rolling cutoff down to a half-hour reading boundary", () => {
    const now = Date.parse("2026-07-10T18:17:42Z");
    expect(new Date(octopusStableCutoffJst(now)).toISOString()).toBe("2026-07-08T18:00:00.000Z");
  });

  it("never requests or retains readings older than November 2025", async () => {
    const now = Date.parse("2026-07-10T18:00:00Z");
    const comparison = {
      from: new Date("2026-06-25T15:00:00.000Z"),
      to: new Date("2026-07-02T15:00:00.000Z"),
    };
    const requested: OctopusRange[] = [];
    const fetchRange = async (range: OctopusRange): Promise<OctopusReading[]> => {
      requested.push(range);
      return [readingInside(range)];
    };

    let result = await synchronizeOctopusHistory(env, "A-floor", now, "profile", comparison, fetchRange);
    for (let run = 1; run < 12 && !result.completed; run += 1) {
      result = await synchronizeOctopusHistory(env, "A-floor", now, "profile", comparison, fetchRange);
    }

    expect(result.completed).toBe(true);
    expect(result.cursorBefore).toBe(OCTOPUS_HISTORY_FLOOR_MS);
    expect(requested.every(range => range.from.getTime() >= OCTOPUS_HISTORY_FLOOR_MS)).toBe(true);

    await env.DB.prepare(
      `INSERT INTO octopus_readings(account_number,supply_point,observed_at,energy_kwh,updated_at)
       VALUES('A-floor','old-spin',?1,1.0,?2)`,
    ).bind(OCTOPUS_HISTORY_FLOOR_MS - 86_400_000, now).run();
    await synchronizeOctopusHistory(env, "A-floor", now, "profile", comparison, fetchRange);
    const oldRows = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM octopus_readings WHERE account_number='A-floor' AND observed_at<?1",
    ).bind(OCTOPUS_HISTORY_FLOOR_MS).first<{ count: number }>();
    expect(oldRows?.count).toBe(0);
  });

  it("continues through long empty periods until the November floor", async () => {
    const now = Date.parse("2026-07-10T18:00:00Z");
    const comparison = {
      from: new Date("2026-06-25T15:00:00.000Z"),
      to: new Date("2026-07-02T15:00:00.000Z"),
    };
    const fetchRange = async (): Promise<OctopusReading[]> => [];

    const first = await synchronizeOctopusHistory(env, "A-empty", now, "profile", comparison, fetchRange);
    expect(first.completed).toBe(false);
    const second = await synchronizeOctopusHistory(env, "A-empty", now, "profile", comparison, fetchRange);
    expect(second.completed).toBe(false);

    await env.DB.prepare(
      `UPDATE octopus_backfill_state SET completed=1
        WHERE account_number='A-empty'`,
    ).run();
    const resumed = await synchronizeOctopusHistory(env, "A-empty", now, "profile", comparison, fetchRange);
    expect(resumed.completed).toBe(false);

    let result = resumed;
    for (let run = 0; run < 12 && !result.completed; run += 1) {
      result = await synchronizeOctopusHistory(env, "A-empty", now, "profile", comparison, fetchRange);
    }
    expect(result.completed).toBe(true);
    expect(result.cursorBefore).toBe(OCTOPUS_HISTORY_FLOOR_MS);

    const state = await env.DB.prepare(
      "SELECT consecutive_empty_days,completed FROM octopus_backfill_state WHERE account_number=?1",
    ).bind("A-empty").first<{ consecutive_empty_days: number; completed: number }>();
    expect(Number(state?.consecutive_empty_days)).toBeGreaterThan(62);
    expect(state?.completed).toBe(1);
  });
});
