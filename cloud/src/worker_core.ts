import { adminPage } from "./admin";
import { authorizedAction, authorizedAnyDevice, authorizedDevice, DEVICE_ID_PATTERN } from "./auth";
import { methodNotAllowed, etagResponse, unauthorized } from "./response";
import { requestRefresh, runScheduler } from "./scheduler";
import { buildMeta, ensureDashboard, readState, sha256Hex, updateState, WORKER_VERSION, type StateRow } from "./snapshot";
import { constantTimeEqual } from "./crypto_cache";
import { updateFileResponse, updateManifestResponse } from "./update_proxy";
import { handleSwitchBotWebhook, webhookToken } from "./switchbot";
import {
  acknowledgeDeviceCommand,
  createDeviceCommand,
  getDeviceCommands,
  getDeviceConfig,
  getDeviceSync,
  proxyRadarTile,
  putDeviceConfig,
} from "./device_control";
import type { Env } from "./sources";
import { fetchStationhead } from "./spotify_source";
import { receiveTelemetryOptimized } from "./telemetry_route";

interface EnvironmentHistoryRow {
  t: number;
  co2: number | null;
  temperature: number | null;
  humidity: number | null;
}

interface EnvironmentPoint {
  t: number;
  co2: number | null;
  temperature: number | null;
  humidity: number | null;
}

interface EnvironmentDeviceHistory {
  deviceId: string;
  bucketMinutes: number;
  history: EnvironmentPoint[];
}

const ENVIRONMENT_HISTORY_MS = 24 * 60 * 60 * 1000;

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function deviceIdFromRequest(request: Request): string | null {
  const deviceId = new URL(request.url).searchParams.get("deviceId")?.trim() ?? "";
  return DEVICE_ID_PATTERN.test(deviceId) ? deviceId : null;
}

async function dashboardJsonResponse(request: Request, env: Env): Promise<Response> {
  const snapshot = await ensureDashboard(env);
  return etagResponse(request, snapshot.payload, "application/json; charset=utf-8", snapshot.content_hash!);
}

async function stateJson(request: Request, env: Env, source: string): Promise<Response> {
  const state = await readState(env, source);
  if (!state) return json({ error: `${source} unavailable` }, { status: 503 });
  return etagResponse(request, state.payload, "application/json; charset=utf-8", state.content_hash!);
}

async function stationheadState(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const state = await readState(env, "stationhead");
  if (state) return etagResponse(request, state.payload, "application/json; charset=utf-8", state.content_hash!);
  ctx.waitUntil(fetchStationhead(env)
    .then(result => updateState(env, result))
    .catch(error => console.error("Stationhead warm-up failed", error instanceof Error ? error.message : String(error))));
  return json({ configured: false, connected: false, playing: false }, { status: 503 });
}

function environmentPoint(value: unknown): EnvironmentPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const t = Number(input.t);
  if (!Number.isSafeInteger(t)) return null;
  const nullable = (field: string): number | null => {
    if (input[field] === null || input[field] === undefined) return null;
    const number = Number(input[field]);
    return Number.isFinite(number) ? number : null;
  };
  return { t, co2: nullable("co2"), temperature: nullable("temperature"), humidity: nullable("humidity") };
}

function previousEnvironmentDevices(previous: StateRow | null, cutoff: number): Record<string, EnvironmentDeviceHistory> {
  if (!previous?.payload) return {};
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(previous.payload) as unknown;
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }

  const devices: Record<string, EnvironmentDeviceHistory> = {};
  const add = (deviceId: string, value: unknown): void => {
    if (!DEVICE_ID_PATTERN.test(deviceId) || !value || typeof value !== "object" || Array.isArray(value)) return;
    const history = Array.isArray((value as Record<string, unknown>).history)
      ? ((value as Record<string, unknown>).history as unknown[])
        .map(environmentPoint)
        .filter((point): point is EnvironmentPoint => point !== null && point.t >= cutoff)
      : [];
    if (history.length) devices[deviceId] = { deviceId, bucketMinutes: 5, history };
  };

  const rawDevices = payload.devices;
  if (rawDevices && typeof rawDevices === "object" && !Array.isArray(rawDevices)) {
    for (const [deviceId, value] of Object.entries(rawDevices as Record<string, unknown>)) add(deviceId, value);
  }
  const rootDeviceId = String(payload.deviceId ?? "");
  if (!devices[rootDeviceId] && Array.isArray(payload.history)) add(rootDeviceId, payload);
  return devices;
}

async function updateEnvironmentHistory(
  env: Env,
  fallbackDeviceId: string,
  affectedBucketAts: number[],
  now: number,
): Promise<void> {
  const cutoff = now - ENVIRONMENT_HISTORY_MS;
  const recentBucketAts = [...new Set(affectedBucketAts.filter(bucketAt => bucketAt >= cutoff))].sort((left, right) => left - right);
  if (!recentBucketAts.length) return;
  const placeholders = recentBucketAts.map((_, index) => `?${index + 2}`).join(",");
  const rows = await env.DB.prepare(
    `SELECT bucket_at AS t,
            CASE WHEN co2_count > 0 THEN co2_sum / co2_count ELSE NULL END AS co2,
            CASE WHEN temperature_count > 0 THEN temperature_sum / temperature_count ELSE NULL END AS temperature,
            CASE WHEN humidity_count > 0 THEN humidity_sum / humidity_count ELSE NULL END AS humidity
       FROM environment_buckets
      WHERE device_id=?1 AND bucket_at IN (${placeholders})
      ORDER BY bucket_at`,
  ).bind(fallbackDeviceId, ...recentBucketAts).all<EnvironmentHistoryRow>();
  if (!rows.results?.length) return;

  const previous = await readState(env, "environment");
  const devices = previousEnvironmentDevices(previous, cutoff);
  const target = devices[fallbackDeviceId] ?? { deviceId: fallbackDeviceId, bucketMinutes: 5, history: [] };
  const points = new Map(target.history.map(point => [point.t, point]));
  for (const row of rows.results) {
    points.set(Number(row.t), {
      t: Number(row.t),
      co2: row.co2 === null ? null : Math.round(Number(row.co2)),
      temperature: row.temperature === null ? null : Number(Number(row.temperature).toFixed(2)),
      humidity: row.humidity === null ? null : Number(Number(row.humidity).toFixed(2)),
    });
  }
  target.history = [...points.values()].filter(point => point.t >= cutoff).sort((left, right) => left.t - right.t);
  devices[fallbackDeviceId] = target;
  for (const [deviceId, device] of Object.entries(devices)) {
    device.history = device.history.filter(point => point.t >= cutoff).sort((left, right) => left.t - right.t);
    if (!device.history.length) delete devices[deviceId];
  }

  let previousDeviceId = "";
  if (previous?.payload) {
    try { previousDeviceId = String((JSON.parse(previous.payload) as { deviceId?: unknown }).deviceId ?? ""); } catch { /* ignore */ }
  }
  const preferred = env.HOMEPANEL_PRIMARY_DEVICE_ID?.trim() ?? "";
  const selectedId = devices[preferred]
    ? preferred
    : devices[previousDeviceId] ? previousDeviceId
      : devices[fallbackDeviceId] ? fallbackDeviceId
        : Object.keys(devices).sort()[0] ?? fallbackDeviceId;
  const selected = devices[selectedId] ?? { deviceId: selectedId, bucketMinutes: 5, history: [] };
  await updateState(env, {
    source: "environment",
    observedAt: now,
    payload: { ...selected, devices },
  }, undefined, previous);
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/admin") return request.method === "GET" ? adminPage() : methodNotAllowed(["GET"]);

  if (request.method === "GET" && url.pathname === "/v1/health") {
    const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return json({ ok: row?.ok === 1, workerVersion: WORKER_VERSION, now: new Date().toISOString() });
  }

  if (request.method === "GET" && url.pathname.startsWith("/v1/radar/tile/")) return proxyRadarTile(request);

  if (request.method === "GET" && url.pathname.startsWith("/v1/wx-icon/")) {
    const match = url.pathname.match(/^\/v1\/wx-icon\/(\d+)_(day|night)\.png$/);
    if (match) {
      const upstream = `https://s.yimg.jp/images/weather/general/next/size90/${match[1]}_${match[2]}.png`;
      try {
        const response = await fetch(upstream, { cf: { cacheEverything: true, cacheTtl: 86400 } } as RequestInit);
        if (!response.ok) return new Response(null, { status: 502 });
        return new Response(response.body, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch {
        return new Response(null, { status: 502 });
      }
    }
  }

  const webhookPrefix = "/v1/switchbot/webhook/";
  if (url.pathname.startsWith(webhookPrefix)) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    const supplied = url.pathname.slice(webhookPrefix.length);
    const expected = await webhookToken(env);
    if (!expected || !constantTimeEqual(supplied, expected)) return json({ error: "not found" }, { status: 404 });
    return handleSwitchBotWebhook(request, env);
  }

  if (url.pathname === "/v1/device/sync") {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    const deviceId = deviceIdFromRequest(request);
    if (!deviceId) return json({ error: "valid deviceId is required" }, { status: 400 });
    if (!authorizedDevice(request, env, deviceId)) return unauthorized();
    return getDeviceSync(request, env);
  }

  if (url.pathname === "/v1/device/config") {
    if (!["GET", "PUT"].includes(request.method)) return methodNotAllowed(["GET", "PUT"]);
    const deviceId = deviceIdFromRequest(request);
    if (!deviceId) return json({ error: "valid deviceId is required" }, { status: 400 });
    if (request.method === "PUT" && !authorizedAction(request, env)) return unauthorized();
    if (request.method === "GET" && !authorizedAction(request, env) && !authorizedDevice(request, env, deviceId)) {
      return unauthorized();
    }
    return request.method === "GET" ? getDeviceConfig(request, env) : putDeviceConfig(request, env);
  }

  if (url.pathname === "/v1/device/commands") {
    if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(["GET", "POST"]);
    if (request.method === "POST") {
      if (!authorizedAction(request, env)) return unauthorized();
      return createDeviceCommand(request, env);
    }
    const deviceId = deviceIdFromRequest(request);
    if (!deviceId) return json({ error: "valid deviceId is required" }, { status: 400 });
    if (!authorizedDevice(request, env, deviceId)) return unauthorized();
    return getDeviceCommands(request, env);
  }

  if (url.pathname === "/v1/device/commands/ack") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    const deviceId = deviceIdFromRequest(request);
    if (!deviceId) return json({ error: "valid deviceId is required" }, { status: 400 });
    if (!authorizedDevice(request, env, deviceId)) return unauthorized();
    return acknowledgeDeviceCommand(request, env);
  }

  if (url.pathname === "/v1/update/manifest") {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    return updateManifestResponse(request, env);
  }

  const updateFilePrefix = "/v1/update/file/";
  if (url.pathname.startsWith(updateFilePrefix)) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    return updateFileResponse(request, env, decodeURIComponent(url.pathname.slice(updateFilePrefix.length)));
  }

  if (["/v1/meta", "/v1/dashboard.json", "/v1/radar", "/v1/switchbot", "/v1/stationhead"].includes(url.pathname)) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    if (url.pathname === "/v1/meta") {
      const payload = JSON.stringify(await buildMeta(env));
      return etagResponse(request, payload, "application/json; charset=utf-8", await sha256Hex(payload));
    }
    if (url.pathname === "/v1/dashboard.json") return dashboardJsonResponse(request, env);
    if (url.pathname === "/v1/switchbot") return stateJson(request, env, "switchbot");
    if (url.pathname === "/v1/stationhead") return stationheadState(request, env, ctx);
    return stateJson(request, env, "radar");
  }

  if (url.pathname === "/v1/telemetry") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    return receiveTelemetryOptimized(request, env);
  }

  if (url.pathname === "/v1/refresh") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    if (!authorizedAction(request, env)) return unauthorized();
    let names: string[] | undefined;
    try {
      const body = await request.json() as { sources?: unknown };
      if (Array.isArray(body.sources)) names = body.sources.filter((value): value is string => typeof value === "string");
    } catch { /* empty body refreshes all */ }
    await requestRefresh(env, names);
    ctx.waitUntil(runScheduler(env));
    return json({ queued: true }, { status: 202 });
  }

  return json({ error: "not found" }, { status: 404 });
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return route(request, env, ctx).catch(error => {
      console.error("request failed", error instanceof Error ? error.message : String(error));
      return json({ error: "internal error" }, { status: 500 });
    });
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduler(env));
  },
} satisfies ExportedHandler<Env>;
