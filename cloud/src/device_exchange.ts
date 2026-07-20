import { authorizedDevice, deviceIdFromRequest } from "./auth";
import { buildDeviceSyncPayload } from "./device_sync";
import { radarBundleResponseForPayload } from "./radar_bundle";
import type { Env } from "./sources";
import { receiveTelemetryOptimized } from "./telemetry_route";

const EXCHANGE_MAGIC = new TextEncoder().encode("HPEX0001");
const ENCODER = new TextEncoder();
const RADAR_BUNDLE_PATH = /^\/v1\/radar\/bundle\/(\d{14})\.hpb$/;
const VERSION_FIELDS = [
  "dashboard",
  "radar",
  "switchbot",
  "stationhead",
  "stationheadHealth",
  "config",
] as const;

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

function exchangeStream(jsonBytes: Uint8Array, radarBytes: Uint8Array): ReadableStream<Uint8Array> {
  const header = new Uint8Array(EXCHANGE_MAGIC.length + 4);
  header.set(EXCHANGE_MAGIC);
  writeUint32(header, EXCHANGE_MAGIC.length, jsonBytes.length);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(header);
      controller.enqueue(jsonBytes);
      if (radarBytes.length) controller.enqueue(radarBytes);
      controller.close();
    },
  });
}

function syncRequest(request: Request, deviceId: string, versions: Record<string, unknown>): Request {
  const url = new URL("/v1/device/sync", request.url);
  url.searchParams.set("deviceId", deviceId);
  for (const field of VERSION_FIELDS) {
    const raw = Number(versions[field]);
    const value = Number.isSafeInteger(raw) && raw >= 0 ? raw : -1;
    url.searchParams.set(`${field}Version`, String(value));
  }
  return new Request(url, { method: "GET", headers: request.headers });
}

async function applyTelemetry(
  request: Request,
  env: Env,
  telemetry: unknown,
  payload: Record<string, unknown>,
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const authorization = request.headers.get("Authorization");
  if (authorization) headers.set("Authorization", authorization);
  const telemetryResponse = await receiveTelemetryOptimized(new Request("https://exchange.internal/v1/telemetry", {
    method: "POST",
    headers,
    body: JSON.stringify(telemetry),
  }), env);
  if (telemetryResponse.status === 200) {
    payload.telemetry = await telemetryResponse.json<unknown>();
    return;
  }
  let detail: unknown = null;
  try { detail = await telemetryResponse.json<unknown>(); } catch { detail = null; }
  payload.telemetryError = { status: telemetryResponse.status, detail };
}

async function embeddedRadarBundle(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  payload: Record<string, unknown>,
): Promise<Uint8Array> {
  if (typeof payload.radar !== "string") return new Uint8Array();
  let radar: unknown;
  try {
    radar = JSON.parse(payload.radar);
  } catch {
    payload.radarBundleError = "invalid_radar_payload";
    return new Uint8Array();
  }
  if (!radar || typeof radar !== "object") return new Uint8Array();
  const bundleUrl = (radar as Record<string, unknown>).bundleUrl;
  if (typeof bundleUrl !== "string") return new Uint8Array();
  const match = new URL(bundleUrl, request.url).pathname.match(RADAR_BUNDLE_PATH);
  if (!match) return new Uint8Array();

  const absoluteUrl = new URL(bundleUrl, request.url).toString();
  const response = await radarBundleResponseForPayload(absoluteUrl, radar, match[1]!, env, ctx);
  if (!response.ok) {
    payload.radarBundleError = `HTTP ${response.status}`;
    return new Uint8Array();
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  payload.radarBundleIncluded = bytes.length > 0;
  return bytes;
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

  const payload = await buildDeviceSyncPayload(syncRequest(request, deviceId, versions), env);
  if (input.telemetry !== undefined) await applyTelemetry(request, env, input.telemetry, payload);
  const radarBytes = await embeddedRadarBundle(request, env, ctx, payload);
  const jsonBytes = ENCODER.encode(JSON.stringify(payload));
  return new Response(exchangeStream(jsonBytes, radarBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.homepanel.device-exchange",
      "Cache-Control": "private, no-store",
      "X-HomePanel-Exchange-Json-Bytes": String(jsonBytes.length),
      "X-HomePanel-Exchange-Radar-Bytes": String(radarBytes.length),
    },
  });
}
