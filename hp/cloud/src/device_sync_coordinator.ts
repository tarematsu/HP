import {
  buildDeviceSyncPayloadForDevice,
  readDeviceSyncManifest,
  type DeviceSyncManifestRow,
} from "./device_sync";
import { DEVICE_SYNC_MANIFEST_KEY } from "./device_sync_coordinator_client";
import type { Env } from "./sources";

interface DeviceSyncRequest {
  deviceId?: unknown;
  versions?: unknown;
}

export class DeviceSyncCoordinator {
  private manifestGeneration = 0;
  private manifestLoad: Promise<DeviceSyncManifestRow> | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private async loadManifest(): Promise<DeviceSyncManifestRow> {
    while (true) {
      const generation = this.manifestGeneration;
      const manifest = await readDeviceSyncManifest(this.env);
      if (generation !== this.manifestGeneration) continue;

      await this.state.storage.put(DEVICE_SYNC_MANIFEST_KEY, manifest);
      if (generation === this.manifestGeneration) return manifest;

      await this.state.storage.delete(DEVICE_SYNC_MANIFEST_KEY);
    }
  }

  private async manifest(): Promise<DeviceSyncManifestRow> {
    const stored = await this.state.storage.get<DeviceSyncManifestRow>(DEVICE_SYNC_MANIFEST_KEY);
    if (stored) return stored;
    if (this.manifestLoad) return this.manifestLoad;

    const pending = this.loadManifest();
    this.manifestLoad = pending;
    try {
      return await pending;
    } finally {
      if (this.manifestLoad === pending) this.manifestLoad = null;
    }
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
      this.manifestGeneration += 1;
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
