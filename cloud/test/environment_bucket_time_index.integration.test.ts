import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("environment bucket recovery index", () => {
  it("uses the time-first index for the retained-history scan", async () => {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT device_id,bucket_at AS t,
              CASE WHEN co2_count>0 THEN co2_sum/co2_count ELSE NULL END AS co2,
              CASE WHEN temperature_count>0 THEN temperature_sum/temperature_count ELSE NULL END AS temperature,
              CASE WHEN humidity_count>0 THEN humidity_sum/humidity_count ELSE NULL END AS humidity
         FROM environment_buckets
        WHERE bucket_at>=?1
        ORDER BY bucket_at,device_id`,
    ).bind(Date.now() - 86_400_000).all<{ detail: string }>();

    expect((plan.results ?? []).some(row =>
      row.detail.includes("idx_environment_buckets_time_device")
    )).toBe(true);
  });
});
