import { authorizedDevice, deviceIdFromRequest } from "./auth";
import * as deviceSync from "./device_sync";
import * as deviceSyncCoordinator from "./device_sync_coordinator";
import { queueSchedulerWatchdog } from "./scheduler_coordinator";
import type { Env } from "./sources";
import { applyCompactTelemetryInput } from "./telemetry_compact";

const EXCHANGE_MAGIC = new TextEncoder().encode("HPEX0001");
const ENCODER = new TextEncoder();

interface DeviceExchangeInput {
  versions?: Record<string, unknown>;
  telemetry?: unknown;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = value >>> 8 & 0xff;
  target[offset + 2] = value >>> 16 & 0xff;
  target[offset + 3] = value >>> 24 & 0xff;
}

function exchangeBody(jsonBytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(EXCHANGE_MAGIC.length + 4 + jsonBytes.length);
  output.set(EXCHANGE_MAGIC);
  writeUint32(output, EXCHANGE_MAGIC.length, jsonBytes.length);
  output.set(jsonBytes, EXCHANGE_MAGIC.length + 4);
  return output;
}

async function applyTelemetry(
  env: Env,
  deviceId: string,
  telemetry: unknown,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await applyCompactTelemetryInput(telemetry, env, deviceId);
    if (result.status === 200) {
      payload.telemetry = result.body;
      return;
    }
    payload.telemetryError = { status: result.status, detail: result.body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("device-exchange-telemetry-failed", { deviceId, error: message });
    payload.telemetryError = {
      status: 503,
      detail: { error: "telemetry temporarily unavailable" },
    };
  }
}

export async function deviceExchangeResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const deviceId = deviceIdFromRequest(request);
  if (!deviceId) return Response.json({ error: "valid deviceId is required" }, { status: 400 });
  if (!authorizedDevice(request, env, deviceId)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let input: DeviceExchangeInput;
  try {
    input = await request.json<DeviceExchangeInput>();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Response.json({ error: "body must be an object" }, { status: 400 });
  }
  const versions = input.versions && typeof input.versions === "object" && !Array.isArray(input.versions)
    ? input.versions
    : {};

  queueSchedulerWatchdog(env, ctx);
  const telemetryPayload: Record<string, unknown> = {};
  if (input.telemetry !== undefined) await applyTelemetry(env, deviceId, input.telemetry, telemetryPayload);

  const coordinated = await deviceSyncCoordinator.requestCoordinatedDeviceSync(env, deviceId, versions);
  const payload = coordinated ?? await deviceSync.buildDeviceSyncPayloadForDevice(env, deviceId, versions);
  Object.assign(payload, telemetryPayload);

  const jsonBytes = ENCODER.encode(JSON.stringify(payload));
  const body = exchangeBody(jsonBytes);
  return new Response(body.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.homepanel.device-exchange",
      "Content-Length": String(body.length),
      "Cache-Control": "private, no-store",
      "X-HomePanel-Exchange-Json-Bytes": String(jsonBytes.length),
      "X-HomePanel-Exchange-Radar-Bytes": "0",
    },
  });
}
