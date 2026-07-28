import { adminPage } from "./admin";
import { authorizedAction, authorizedAnyDevice, authorizedDevice, authorizedReadiness, deviceIdFromRequest } from "./auth";
import {
  cachedDashboard,
  cachedDashboardEtag,
  cachedMeta,
  cachedMetaEtag,
} from "./dashboard_cache";
import { deviceExchangeResponse } from "./device_exchange";
import { json } from "./http";
import { normalizeRefreshJobNames } from "./refresh_jobs";
import { methodNotAllowed, etagResponse, suppliedEtags, unauthorized } from "./response";
import { radarBundleResponse } from "./radar_bundle";
import { cachedRadarBundleResponse } from "./radar_bundle_cache";
import { radarFrameResponse } from "./radar_source";
import { queueSchedulerWake } from "./scheduler_coordinator";
import { buildMeta, ensureDashboard, readState, sha256Hex, updateState, WORKER_VERSION } from "./snapshot";
import { constantTimeEqual } from "./crypto_cache";
import { updateFileResponse, updateManifestResponse } from "./update_proxy";
import { handleSwitchBotWebhook, webhookToken } from "./switchbot";
import {
  acknowledgeDeviceCommand,
  createDeviceCommand,
  getDeviceCommands,
  getDeviceConfig,
  putDeviceConfig,
} from "./device_control";
import { getDeviceSync } from "./device_sync";
import { proxyRadarTile } from "./radar_tile";
import type { Env } from "./sources";
import { fetchStationhead } from "./spotify_source";
import { stationheadHealthPayload } from "./stationhead_health";
import { receiveCompactTelemetry } from "./telemetry_compact";
import { queueUpdateCheckPing } from "./update_check";
import {
  spotifyAccessToken,
  spotifyCallback,
  spotifyStatus,
  startSpotifyAuthorization,
} from "./spotify_oauth";

const UPDATE_FILE_PREFIX = "/v1/update/file/";

interface RuntimeBindings extends Env {
  VIDEO_SERVICE?: Fetcher;
  DEVICE_SYNC_COORDINATOR?: DurableObjectNamespace;
  RADAR_BUNDLE_COORDINATOR?: DurableObjectNamespace;
}

interface ReadinessCheck {
  ok: boolean;
  detail?: string;
}

function notModified(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      ETag: etag,
      "Cache-Control": "private, max-age=0, must-revalidate",
      Vary: "Accept-Encoding",
    },
  });
}

async function readinessResponse(request: Request, env: Env): Promise<Response> {
  if (!authorizedReadiness(request, env)) return unauthorized();
  const bindings = env as RuntimeBindings;
  const d1Check: ReadinessCheck = { ok: false };
  const videoServiceCheck: ReadinessCheck = { ok: false };
  const checks = {
    d1: d1Check,
    scheduler: { ok: Boolean(bindings.SCHEDULER_COORDINATOR) },
    deviceSync: { ok: Boolean(bindings.DEVICE_SYNC_COORDINATOR) },
    radarCoordinator: { ok: Boolean(bindings.RADAR_BUNDLE_COORDINATOR) },
    dataBucket: { ok: Boolean(env.DATA_BUCKET) },
    videoService: videoServiceCheck,
  } satisfies Record<string, ReadinessCheck>;

  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    d1Check.ok = Number(row?.ok) === 1;
  } catch (error) {
    d1Check.detail = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
  }

  try {
    if (!bindings.VIDEO_SERVICE) throw new Error("binding unavailable");
    const response = await bindings.VIDEO_SERVICE.fetch("https://video.internal/api/health");
    videoServiceCheck.ok = response.ok;
    if (!response.ok) videoServiceCheck.detail = `HTTP ${response.status}`;
    await response.body?.cancel();
  } catch (error) {
    videoServiceCheck.detail = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
  }

  const ok = Object.values(checks).every(check => check.ok);
  return json({
    ok,
    service: "homepanel-cloud",
    workerVersion: WORKER_VERSION,
    checkedAt: new Date().toISOString(),
    checks,
  }, { status: ok ? 200 : 503 });
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

async function stationheadHealthState(request: Request, env: Env): Promise<Response> {
  const state = await readState(env, "stationhead_health");
  if (!state) return json({ error: "stationhead_health unavailable" }, { status: 503 });
  const payload = JSON.stringify(stationheadHealthPayload(state));
  return etagResponse(
    request,
    payload,
    "application/json; charset=utf-8",
    await sha256Hex(payload),
  );
}

async function stationheadState(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const state = await readState(env, "stationhead");
  if (state) return etagResponse(request, state.payload, "application/json; charset=utf-8", state.content_hash!);
  ctx.waitUntil(fetchStationhead(env)
    .then(result => updateState(env, result))
    .catch(error => console.error("Stationhead warm-up failed", error instanceof Error ? error.message : String(error))));
  return json({ configured: false, connected: false, playing: false }, { status: 503 });
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/admin") return request.method === "GET" ? adminPage() : methodNotAllowed(["GET"]);

  if (request.method === "GET" && path === "/v1/health") {
    return json({ ok: true, service: "homepanel-cloud", workerVersion: WORKER_VERSION, now: new Date().toISOString() });
  }
  if (request.method === "GET" && path === "/v1/ready") return readinessResponse(request, env);

  if (request.method === "POST" && path === "/v1/device/exchange") {
    return deviceExchangeResponse(request, env, ctx);
  }

  if (request.method === "GET" && path.startsWith("/v1/radar/bundle/")) {
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    const cached = await cachedRadarBundleResponse(request, env, ctx);
    if (cached) return cached;
    return radarBundleResponse(request, env, ctx);
  }
  if (request.method === "GET" && path.startsWith("/v1/radar/frame/")) {
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    return radarFrameResponse(path, env);
  }
  if (request.method === "GET" && path.startsWith("/v1/radar/tile/")) return proxyRadarTile(request, env);

  if (request.method === "GET" && path.startsWith("/v1/wx-icon/")) {
    const match = path.match(/^\/v1\/wx-icon\/(\d+)_(day|night)\.png$/);
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

  if (request.method === "POST" && path === "/v1/update/ping") {
    return Response.json({ queued: queueUpdateCheckPing(env, ctx) }, { status: 202 });
  }

  if (request.method === "GET" && path === "/v1/spotify/callback") return spotifyCallback(request, env);
  if (path.startsWith("/v1/spotify/")) {
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    if (request.method === "POST" && path === "/v1/spotify/authorize") return startSpotifyAuthorization(request, env);
    if (request.method === "GET" && path === "/v1/spotify/status") return spotifyStatus(request, env);
    if (request.method === "GET" && path === "/v1/spotify/access-token") return spotifyAccessToken(request, env);
    return json({ error: "not found" }, { status: 404 });
  }

  const signedUpdateAsset = request.method === "GET"
    && path.startsWith(UPDATE_FILE_PREFIX)
    && url.searchParams.has("expires")
    && url.searchParams.has("signature");
  if (signedUpdateAsset) return updateFileResponse(request, env, path.slice(UPDATE_FILE_PREFIX.length));

  if (request.method === "GET" && (path === "/v1/dashboard.json" || path === "/v1/meta")) {
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    const supplied = suppliedEtags(request);
    const cachedEtag = path === "/v1/dashboard.json" ? cachedDashboardEtag(env) : cachedMetaEtag(env);
    if (cachedEtag && supplied.includes(cachedEtag)) return notModified(cachedEtag);
    if (path === "/v1/dashboard.json") {
      const snapshot = await cachedDashboard(env);
      return etagResponse(request, snapshot.payload, "application/json; charset=utf-8", snapshot.content_hash!);
    }
    const meta = await cachedMeta(env);
    return etagResponse(request, meta.payload, "application/json; charset=utf-8", meta.hash);
  }

  const webhookPrefix = "/v1/switchbot/webhook/";
  if (path.startsWith(webhookPrefix)) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    const supplied = path.slice(webhookPrefix.length);
    const expected = await webhookToken(env);
    if (!expected || !constantTimeEqual(supplied, expected)) return json({ error: "not found" }, { status: 404 });
    return handleSwitchBotWebhook(request, env);
  }

  if (path === "/v1/device/sync") {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    const deviceId = deviceIdFromRequest(request);
    if (!deviceId) return json({ error: "valid deviceId is required" }, { status: 400 });
    if (!authorizedDevice(request, env, deviceId)) return unauthorized();
    return getDeviceSync(request, env);
  }

  if (path === "/v1/device/config") {
    if (!["GET", "PUT"].includes(request.method)) return methodNotAllowed(["GET", "PUT"]);
    const deviceId = deviceIdFromRequest(request);
    if (!deviceId) return json({ error: "valid deviceId is required" }, { status: 400 });
    if (request.method === "PUT" && !authorizedAction(request, env)) return unauthorized();
    if (request.method === "GET" && !authorizedAction(request, env) && !authorizedDevice(request, env, deviceId)) {
      return unauthorized();
    }
    return request.method === "GET" ? getDeviceConfig(request, env) : putDeviceConfig(request, env);
  }

  if (path === "/v1/device/commands") {
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

  if (path === "/v1/device/commands/ack") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    const deviceId = deviceIdFromRequest(request);
    if (!deviceId) return json({ error: "valid deviceId is required" }, { status: 400 });
    if (!authorizedDevice(request, env, deviceId)) return unauthorized();
    return acknowledgeDeviceCommand(request, env);
  }

  if (path === "/v1/update/manifest") {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    return updateManifestResponse(request, env);
  }
  if (path.startsWith(UPDATE_FILE_PREFIX)) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    return updateFileResponse(request, env, path.slice(UPDATE_FILE_PREFIX.length));
  }

  if (["/v1/radar", "/v1/switchbot", "/v1/stationhead", "/v1/stationhead-health"].includes(path)) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    if (!authorizedAnyDevice(request, env)) return unauthorized();
    if (path === "/v1/switchbot") return stateJson(request, env, "switchbot");
    if (path === "/v1/stationhead") return stationheadState(request, env, ctx);
    if (path === "/v1/stationhead-health") return stationheadHealthState(request, env);
    return stateJson(request, env, "radar");
  }

  if (path === "/v1/telemetry/compact") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    return receiveCompactTelemetry(request, env, ctx);
  }

  if (path === "/v1/refresh") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    if (!authorizedAction(request, env)) return unauthorized();
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return json({ error: "invalid json" }, { status: 400 });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "body must be an object" }, { status: 400 });
    }
    const body = parsed as { sources?: unknown };
    if (body.sources !== undefined && !Array.isArray(body.sources)) {
      return json({ error: "sources must be an array" }, { status: 400 });
    }
    if (Array.isArray(body.sources) && body.sources.some(value => typeof value !== "string")) {
      return json({ error: "sources must contain only strings" }, { status: 400 });
    }
    const requested = Array.isArray(body.sources) ? body.sources as string[] : undefined;
    const names = normalizeRefreshJobNames(requested);
    if (!names) return json({ error: "sources must include a supported source" }, { status: 400 });
    if (!queueSchedulerWake(env, ctx, names)) return json({ error: "scheduler unavailable" }, { status: 503 });
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
} satisfies ExportedHandler<Env>;
