import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { invalidateR2EnvironmentCache } from "../src/environment_r2";
import { resetD1TestDatabase } from "./d1_test_utils";

type TestEnv = typeof env & {
  DATA_BUCKET: R2Bucket;
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

type TelemetryReceipt = {
  accepted: number;
  acknowledgedSequences: number[];
  nextSequence: number;
};

function testEnv(): TestEnv {
  return env as TestEnv;
}

beforeEach(async () => {
  const bindings = testEnv();
  await resetD1TestDatabase(bindings.DB, bindings.TEST_MIGRATIONS);
  await bindings.DATA_BUCKET.delete("environment/v2/latest.json");
  invalidateR2EnvironmentCache(bindings);
});

function decodeExchange(bytes: Uint8Array): Record<string, unknown> {
  expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("HPEX0001");
  const jsonLength = bytes[8]!
    | bytes[9]! << 8
    | bytes[10]! << 16
    | bytes[11]! << 24;
  return JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + jsonLength))) as Record<string, unknown>;
}

async function exchangeTelemetry(
  sequence: number,
  observedAt: number,
  co2: number,
): Promise<TelemetryReceipt> {
  const response = await SELF.fetch(
    "https://homepanel.test/v1/device/exchange?deviceId=homepanel-device",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer test-device",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        versions: {
          dashboard: 0,
          radar: 0,
          switchbot: 0,
          stationhead: 0,
          stationheadHealth: 0,
          config: 0,
        },
        telemetry: {
          deviceId: "homepanel-device",
          appVersion: "2.13.0",
          stationheadOk: true,
          outboxCount: 1,
          samples: [{ sequence, observedAt, co2 }],
        },
      }),
    },
  );
  expect(response.status).toBe(200);
  const payload = decodeExchange(new Uint8Array(await response.arrayBuffer()));
  return payload.telemetry as TelemetryReceipt;
}

describe("compact telemetry sequence collisions", () => {
  it("acknowledges an exact retry but not a different sample that reuses its sequence", async () => {
    const recent = Math.floor((Date.now() - 60_000) / 900_000) * 900_000;
    const earlier = recent - 900_000;

    expect(await exchangeTelemetry(1, earlier, 640)).toEqual({
      accepted: 1,
      acknowledgedSequences: [1],
      nextSequence: 2,
    });
    expect(await exchangeTelemetry(1, earlier, 640)).toEqual({
      accepted: 0,
      acknowledgedSequences: [1],
      nextSequence: 2,
    });
    expect(await exchangeTelemetry(1, recent, 720)).toEqual({
      accepted: 0,
      acknowledgedSequences: [],
      nextSequence: 2,
    });

    const beforeRebase = await testEnv().DATA_BUCKET.get("environment/v2/latest.json");
    const beforeDocument = await beforeRebase!.json<{ row: { payload: string } }>();
    const beforePayload = JSON.parse(beforeDocument.row.payload) as {
      history: Array<{ t: number; co2: number }>;
    };
    expect(beforePayload.history).toEqual([
      { t: earlier, co2: 640, temperature: null, humidity: null },
    ]);

    expect(await exchangeTelemetry(2, recent, 720)).toEqual({
      accepted: 1,
      acknowledgedSequences: [2],
      nextSequence: 3,
    });

    const afterRebase = await testEnv().DATA_BUCKET.get("environment/v2/latest.json");
    const afterDocument = await afterRebase!.json<{ row: { payload: string } }>();
    const afterPayload = JSON.parse(afterDocument.row.payload) as {
      history: Array<{ t: number; co2: number }>;
    };
    expect(afterPayload.history).toEqual([
      { t: earlier, co2: 640, temperature: null, humidity: null },
      { t: recent, co2: 720, temperature: null, humidity: null },
    ]);
  });
});
