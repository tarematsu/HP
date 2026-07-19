import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("telemetry request aggregation", () => {
  it("does not consume unrelated pending rows from the same time bucket", async () => {
    const bucketAt = Math.floor((Date.now() - 1000) / 300_000) * 300_000;
    await env.DB.prepare(
      `INSERT INTO environment_samples(
         device_id,sequence,observed_at,co2,temperature,humidity,
         temperature_corrected,humidity_corrected,bucket_applied
       ) VALUES('device-a',999,?1,900,NULL,NULL,NULL,NULL,0)`,
    ).bind(bucketAt).run();

    const response = await SELF.fetch("https://homepanel.test/v1/telemetry", {
      method: "POST",
      headers: { Authorization: "Bearer token-a", "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: "device-a",
        samples: [{ sequence: 1, observedAt: bucketAt, co2: 600 }],
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ accepted: 1, acknowledgedSequences: [1] });

    const bucket = await env.DB.prepare(
      "SELECT sample_count,co2_sum FROM environment_buckets WHERE device_id='device-a' AND bucket_at=?1",
    ).bind(bucketAt).first<{ sample_count: number; co2_sum: number }>();
    expect(bucket).toEqual({ sample_count: 1, co2_sum: 600 });

    const orphan = await env.DB.prepare(
      "SELECT bucket_applied FROM environment_samples WHERE device_id='device-a' AND sequence=999",
    ).first<{ bucket_applied: number }>();
    expect(orphan?.bucket_applied).toBe(0);
  });
});
