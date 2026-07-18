import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  synchronizeOctopusHistory,
  type OctopusRange,
  type OctopusReading,
} from "../src/octopus_history";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

const HOUR_MS = 60 * 60_000;

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("Octopus idempotent writes", () => {
  it("keeps updated_at stable for unchanged readings and updates corrected values", async () => {
    const firstNow = Date.parse("2026-07-10T18:00:00Z");
    const observedAt = Date.parse("2026-07-07T18:00:00Z");
    const comparison = {
      from: new Date("2026-06-25T15:00:00.000Z"),
      to: new Date("2026-07-02T15:00:00.000Z"),
    };
    let energyKwh = 0.25;
    const fetchRange = async (range: OctopusRange): Promise<OctopusReading[]> => {
      if (range.from.getTime() > observedAt || observedAt >= range.to.getTime()) return [];
      return [{
        supplyPoint: "spin-idempotent",
        startAt: new Date(observedAt).toISOString(),
        value: energyKwh,
      }];
    };

    await synchronizeOctopusHistory(
      env,
      "A-idempotent",
      firstNow,
      "idempotent-profile",
      comparison,
      fetchRange,
    );
    const initial = await env.DB.prepare(
      `SELECT energy_kwh,updated_at FROM octopus_readings
        WHERE account_number=?1 AND supply_point=?2 AND observed_at=?3`,
    ).bind("A-idempotent", "spin-idempotent", observedAt)
      .first<{ energy_kwh: number; updated_at: number }>();
    expect(initial).toEqual({ energy_kwh: 0.25, updated_at: firstNow });

    const unchangedNow = firstNow + 6 * HOUR_MS;
    await synchronizeOctopusHistory(
      env,
      "A-idempotent",
      unchangedNow,
      "idempotent-profile",
      comparison,
      fetchRange,
    );
    const unchanged = await env.DB.prepare(
      `SELECT energy_kwh,updated_at FROM octopus_readings
        WHERE account_number=?1 AND supply_point=?2 AND observed_at=?3`,
    ).bind("A-idempotent", "spin-idempotent", observedAt)
      .first<{ energy_kwh: number; updated_at: number }>();
    expect(unchanged).toEqual({ energy_kwh: 0.25, updated_at: firstNow });

    energyKwh = 0.5;
    const correctedNow = unchangedNow + 6 * HOUR_MS;
    await synchronizeOctopusHistory(
      env,
      "A-idempotent",
      correctedNow,
      "idempotent-profile",
      comparison,
      fetchRange,
    );
    const corrected = await env.DB.prepare(
      `SELECT energy_kwh,updated_at FROM octopus_readings
        WHERE account_number=?1 AND supply_point=?2 AND observed_at=?3`,
    ).bind("A-idempotent", "spin-idempotent", observedAt)
      .first<{ energy_kwh: number; updated_at: number }>();
    expect(corrected).toEqual({ energy_kwh: 0.5, updated_at: correctedNow });
  });
});
