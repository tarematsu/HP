import { describe, expect, it, vi } from "vitest";
import { getDeviceSync } from "../src/device_sync";
import type { Env } from "../src/sources";

function prepared(sql: string) {
  return { sql, bind: vi.fn(() => ({ sql })) };
}

describe("device sync unchanged fast path", () => {
  it("does not fetch state payload rows when every client version matches", async () => {
    const statements: string[] = [];
    const prepare = vi.fn((sql: string) => {
      statements.push(sql);
      return prepared(sql);
    });
    const batch = vi.fn().mockResolvedValue([
      {
        results: [{
          dashboard_version: 27,
          radar_version: 8,
          switchbot_version: 5,
          stationhead_version: 6,
          stationhead_health_version: 10,
        }],
      },
      { results: [{ config_version: 9, config_updated_at: 123, pending: 0 }] },
    ]);
    const env = {
      DB: { prepare, batch } as unknown as D1Database,
    } as Env;
    const request = new Request(
      "https://homepanel.test/v1/device/sync?deviceId=homepanel-device" +
      "&dashboardVersion=27&radarVersion=8&switchbotVersion=5" +
      "&stationheadVersion=6&stationheadHealthVersion=10&configVersion=9",
    );

    const response = await getDeviceSync(request, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workerVersion: "2.11.0",
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
    expect(batch).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(statements[0]).toContain("SUM(CASE");
    expect(statements.some(sql => sql.includes("SELECT source,version,payload"))).toBe(false);
  });
});
