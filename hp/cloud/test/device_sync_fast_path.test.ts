import { describe, expect, it, vi } from "vitest";
import { getDeviceSync } from "../src/device_sync";
import { requestCoordinatedDeviceSync } from "../src/device_sync_coordinator_client";
import type { Env } from "../src/sources";

describe("device sync unchanged fast path", () => {
  it("uses bounded manifest and device-specific statements without fetching state payload rows", async () => {
    const statements: string[] = [];
    const manifestFirst = vi.fn().mockResolvedValue({
      dashboard_version: 27,
      environment_version: 0,
      environment_fetched_at: 0,
      radar_version: 8,
      switchbot_version: 5,
      stationhead_version: 6,
      stationhead_health_version: 10,
    });
    const deviceFirst = vi.fn().mockResolvedValue({
      config_version: 9,
      config_updated_at: 123,
      config_payload: "{}",
      pending: 0,
    });
    const prepare = vi.fn((sql: string) => {
      statements.push(sql);
      if (sql.includes("FROM sync_manifest AS manifest")) {
        return { first: manifestFirst };
      }
      return {
        bind: vi.fn(() => ({ first: deviceFirst })),
      };
    });
    const env = {
      DB: { prepare } as unknown as D1Database,
    } as Env;
    const request = new Request(
      "https://homepanel.test/v1/device/sync?deviceId=homepanel-device" +
      "&dashboardVersion=27&radarVersion=8&switchbotVersion=5" +
      "&stationheadVersion=6&stationheadHealthVersion=10&configVersion=9",
    );

    const response = await getDeviceSync(request, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workerVersion: "2.13.0",
      versions: {
        dashboard: 27,
        radar: 8,
        switchbot: 5,
        stationhead: 6,
        stationheadHealth: 10,
        config: 9,
      },
      commands: [],
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(manifestFirst).toHaveBeenCalledTimes(1);
    expect(deviceFirst).toHaveBeenCalledTimes(1);
    expect(statements[0]).toContain("FROM sync_manifest AS manifest");
    expect(statements[0]).not.toContain("SUM(CASE");
    expect(statements[1]).toContain("device_configs");
    expect(statements[1]).toContain("device_commands");
    expect(statements.some(sql => sql.includes("SELECT source,version,payload"))).toBe(false);
  });

  it("returns null so callers can use D1 when the coordinator is unavailable", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      DB: {} as D1Database,
      DEVICE_SYNC_COORDINATOR: {
        idFromName: vi.fn(() => ({}) as DurableObjectId),
        get: vi.fn(() => ({ fetch }) as unknown as DurableObjectStub),
      } as unknown as DurableObjectNamespace,
    } as Env & { DEVICE_SYNC_COORDINATOR: DurableObjectNamespace };

    try {
      await expect(requestCoordinatedDeviceSync(env, "homepanel-device", {})).resolves.toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
