import { DEVICE_ID_PATTERN } from "./auth";
import * as deviceSync from "./device_sync";
import * as deviceSyncCoordinator from "./device_sync_coordinator_client";
import {
  buildDeviceExchangeResponse,
  validDeviceExchangeInput,
} from "./device_exchange_payload";
import type { Env } from "./sources";

export class DeviceExchangeCoordinator {
  constructor(
    _state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, {
        status: 405,
        headers: { Allow: "POST" },
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/exchange") return Response.json({ error: "not_found" }, { status: 404 });

    const deviceId = String(url.searchParams.get("deviceId") ?? "").trim();
    if (!DEVICE_ID_PATTERN.test(deviceId)) {
      return Response.json({ error: "valid deviceId is required" }, { status: 400 });
    }

    let value: unknown;
    try {
      value = await request.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    const input = validDeviceExchangeInput(value);
    if (!input) return Response.json({ error: "body must be an object" }, { status: 400 });

    return buildDeviceExchangeResponse(input, this.env, deviceId, async versions => {
      const coordinated = await deviceSyncCoordinator.requestCoordinatedDeviceSync(
        this.env,
        deviceId,
        versions,
      );
      return coordinated ?? deviceSync.buildDeviceSyncPayloadForDevice(this.env, deviceId, versions);
    });
  }
}
