import type { Env } from "./sources";
import { applyCompactTelemetryInput } from "./telemetry_compact";

const EXCHANGE_MAGIC = new TextEncoder().encode("HPEX0001");
const ENCODER = new TextEncoder();

export interface DeviceExchangeInput {
  versions?: Record<string, unknown>;
  telemetry?: unknown;
}

export function validDeviceExchangeInput(value: unknown): DeviceExchangeInput | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as DeviceExchangeInput
    : null;
}

function versionsFromInput(input: DeviceExchangeInput): Record<string, unknown> {
  return input.versions && typeof input.versions === "object" && !Array.isArray(input.versions)
    ? input.versions
    : {};
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

export async function buildDeviceExchangeResponse(
  input: DeviceExchangeInput,
  env: Env,
  deviceId: string,
  buildPayload: (versions: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<Response> {
  const telemetryPayload: Record<string, unknown> = {};
  if (input.telemetry !== undefined) await applyTelemetry(env, deviceId, input.telemetry, telemetryPayload);

  const payload = await buildPayload(versionsFromInput(input));
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
