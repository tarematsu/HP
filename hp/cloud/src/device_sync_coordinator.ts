import {
  buildDeviceSyncPayloadForDevice,
  readDeviceSyncManifest,
  type DeviceSyncManifestRow,
} from "./device_sync";
import type { Env } from "./sources";

const COORDINATOR_NAME = "global";
export const DEVICE_SYNC_MANIFEST_KEY = "device-sync-manifest-v1";

interface DeviceSyncEnv extends Env {
  DEVICE_SYNC_COORDINATOR?: DurableObjectNamespace;
}

interface DeviceSyncRequest {
  deviceId?: unknown;
  versions?: unknown;
}

function coordinatorStub(env: Env): DurableObjectStub | null {
  const namespace = (env as DeviceSyncEnv).DEVICE_SYNC_COORDINATOR;
  return namespace ? namespace.get(namespace.idFromName(COORDINATOR_NAME)) : null;
}

export async function requestCoordinatedDeviceSync(
  env: Env,
  deviceId: string,
  versions: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const stub = coordinatorStub(env);
  if (!stub) return null;
  try {
    const response = await stub.fetch("https://device-sync.internal/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, versions }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json<Record<string, unknown>>();
  } catch (error) {
    console.error("device sync coordinator unavailable; falling back to D1", error instanceof Error
      ? error.message
      : String(error));
    return null;
  }
}

export async function invalidateCoordinatedDeviceSyncManifest(env: Env): Promise<void> {
  const stub = coordinatorStub(env);
  if (!stub) return;
  const response = await stub.fetch("https://device-sync.internal/invalidate", { method: "POST" });
  if (!response.ok) throw new Error(`device sync manifest invalidation failed: HTTP ${response.status}`);
}

export class DeviceSyncCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private async manifest(): Promise<DeviceSyncManifestRow> {
    const stored = await this.state.storage.get<DeviceSyncManifestRow>(DEVICE_SYNC_MANIFEST_KEY);
    if (stored) return stored;
    const manifest = await readDeviceSyncManifest(this.env);
    await this.state.storage.put(DEVICE_SYNC_MANIFEST_KEY, manifest);
    return manifest;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, {
        status: 405,
        headers: { Allow: "POST" },
      });
    }

    const path = new URL(request.url).pathname;
    if (path === "/invalidate") {
      await this.state.storage.delete(DEVICE_SYNC_MANIFEST_KEY);
      return Response.json({ invalidated: true }, { status: 202 });
    }
    if (path !== "/sync") return Response.json({ error: "not_found" }, { status: 404 });

    let body: DeviceSyncRequest = {};
    try {
      body = await request.json<DeviceSyncRequest>();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
    const versions = body.versions && typeof body.versions === "object" && !Array.isArray(body.versions)
      ? body.versions as Record<string, unknown>
      : {};
    if (!deviceId) return Response.json({ error: "invalid_device_id" }, { status: 400 });

    return Response.json(await buildDeviceSyncPayloadForDevice(
      this.env,
      deviceId,
      versions,
      await this.manifest(),
    ));
  }
}
