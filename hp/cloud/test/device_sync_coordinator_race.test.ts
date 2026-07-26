import { describe, expect, it, vi } from "vitest";
import { DeviceSyncCoordinator } from "../src/device_sync_coordinator";
import type { DeviceSyncManifestRow } from "../src/device_sync";
import type { Env } from "../src/sources";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function manifest(version: number): DeviceSyncManifestRow {
  return {
    dashboard_version: version,
    environment_version: 0,
    environment_fetched_at: 0,
    radar_version: version,
    switchbot_version: version,
    stationhead_version: version,
    stationhead_health_version: version,
  };
}

describe("DeviceSyncCoordinator manifest invalidation", () => {
  it("does not restore a stale manifest when invalidation races with a D1 read", async () => {
    const firstRead = deferred<DeviceSyncManifestRow>();
    const firstStarted = deferred<void>();
    let reads = 0;
    const prepare = vi.fn(() => ({
      first: vi.fn(async () => {
        reads += 1;
        if (reads === 1) {
          firstStarted.resolve();
          return firstRead.promise;
        }
        return manifest(2);
      }),
    }));
    const values = new Map<string, unknown>();
    const storage = {
      get: vi.fn(async (key: string) => values.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
      delete: vi.fn(async (key: string) => values.delete(key)),
    };
    const coordinator = new DeviceSyncCoordinator(
      { storage } as unknown as DurableObjectState,
      { DB: { prepare } as unknown as D1Database } as Env,
    );

    const pendingManifest = (coordinator as unknown as {
      manifest(): Promise<DeviceSyncManifestRow>;
    }).manifest();
    await firstStarted.promise;

    const invalidation = await coordinator.fetch(new Request(
      "https://device-sync.internal/invalidate",
      { method: "POST" },
    ));
    expect(invalidation.status).toBe(202);

    firstRead.resolve(manifest(1));

    await expect(pendingManifest).resolves.toEqual(manifest(2));
    expect(reads).toBe(2);
    expect(values.get("device-sync-manifest-v1")).toEqual(manifest(2));
  });
});
