import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await resetD1TestDatabase(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

function decodeExchange(bytes: Uint8Array): { payload: Record<string, unknown>; radar: Uint8Array } {
  expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("HPEX0001");
  const jsonLength = bytes[8]!
    | bytes[9]! << 8
    | bytes[10]! << 16
    | bytes[11]! << 24;
  expect(jsonLength).toBeGreaterThan(0);
  const jsonEnd = 12 + jsonLength;
  return {
    payload: JSON.parse(new TextDecoder().decode(bytes.slice(12, jsonEnd))) as Record<string, unknown>,
    radar: bytes.slice(jsonEnd),
  };
}

const versions = {
  dashboard: 0,
  radar: 0,
  switchbot: 0,
  stationhead: 0,
  stationheadHealth: 0,
  config: 0,
};

describe("device exchange", () => {
  it("requires the configured device token", async () => {
    const response = await SELF.fetch("https://homepanel.test/v1/device/exchange?deviceId=homepanel-device", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ versions }),
    });
    expect(response.status).toBe(401);
  });

  it("returns sync and telemetry receipt in one binary response", async () => {
    const observedAt = Math.floor((Date.now() - 1000) / 300_000) * 300_000;
    const response = await SELF.fetch("https://homepanel.test/v1/device/exchange?deviceId=homepanel-device", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-device",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        versions,
        telemetry: {
          deviceId: "homepanel-device",
          appVersion: "2.11.0",
          stationheadOk: true,
          outboxCount: 1,
          samples: [{ sequence: 1, observedAt, co2: 640 }],
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/vnd.homepanel.device-exchange");
    const decoded = decodeExchange(new Uint8Array(await response.arrayBuffer()));
    expect(decoded.radar).toHaveLength(0);
    expect(decoded.payload).toMatchObject({
      versions,
      telemetry: {
        accepted: 1,
        acknowledgedSequences: [1],
        nextSequence: 2,
      },
    });
    const bucket = await env.DB.prepare(
      "SELECT sample_count,co2_sum FROM environment_buckets WHERE device_id=?1",
    ).bind("homepanel-device").first<{ sample_count: number; co2_sum: number }>();
    expect(bucket).toMatchObject({ sample_count: 1, co2_sum: 640 });
  });
});
