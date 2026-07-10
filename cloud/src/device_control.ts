import { authorizedAnyDevice } from "./auth";
import { sha256Hex } from "./crypto_cache";
import { json } from "./http";
import type { Env } from "./sources";
import { ensureDashboard, WORKER_VERSION } from "./snapshot";

const MAX_COMMAND_ATTEMPTS = 5;
const ACTIVE_COMMAND_STATUS = "pending";
const ACKNOWLEDGEMENT_LEASE_MS = 30_000;
const VALID_COMMANDS = new Set([
  "refresh",
  "check_update",
  "install_update",
  "restart_app",
  "restart_pc",
  "reconnect_stationhead",
]);

function nowMs(): number { return Date.now(); }

function validDeviceId(value: string): boolean {
  return /^[a-zA-Z0-9._-]{1,64}$/.test(value);
}

function deviceIdFrom(request: Request): string {
  return new URL(request.url).searchParams.get("deviceId")?.trim() ?? "";
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function commandPayload(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export async function getDeviceConfig(request: Request, env: Env): Promise<Response> {
  const deviceId = deviceIdFrom(request);
  if (!validDeviceId(deviceId)) return json({ error: "valid deviceId is required" }, { status: 400 });
  const row = await env.DB.prepare(
    "SELECT version,payload,updated_at FROM device_configs WHERE device_id=?1",
  ).bind(deviceId).first<{ version: number; payload: string; updated_at: number }>();
  if (!row) return json({ deviceId, version: 0, config: {} });
  return json({ deviceId, version: Number(row.version), updatedAt: Number(row.updated_at), config: safeJson(row.payload) ?? {} });
}

export async function putDeviceConfig(request: Request, env: Env): Promise<Response> {
  const deviceId = deviceIdFrom(request);
  if (!validDeviceId(deviceId)) return json({ error: "valid deviceId is required" }, { status: 400 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ error: "invalid json" }, { status: 400 }); }
  const text = JSON.stringify(payload ?? {});
  const now = nowMs();
  const result = await env.DB.prepare(
    `INSERT INTO device_configs(device_id,version,payload,updated_at)
     VALUES(?1,1,?2,?3)
     ON CONFLICT(device_id) DO UPDATE SET
       version=device_configs.version+1,payload=excluded.payload,updated_at=excluded.updated_at
     RETURNING version`,
  ).bind(deviceId, text, now).first<{ version: number }>();
  return json({ ok: true, deviceId, version: Number(result?.version ?? 1), updatedAt: now });
}

export async function createDeviceCommand(request: Request, env: Env): Promise<Response> {
  let body: { deviceId?: unknown; command?: unknown; payload?: unknown };
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, { status: 400 }); }
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!validDeviceId(deviceId)) return json({ error: "valid deviceId is required" }, { status: 400 });
  if (!VALID_COMMANDS.has(command)) return json({ error: "unsupported command" }, { status: 400 });
  const now = nowMs();
  const expiresAt = now + 24 * 60 * 60_000;
  const result = await env.DB.prepare(
    `INSERT INTO device_commands(device_id,command,payload,status,created_at,expires_at)
     VALUES(?1,?2,?3,?4,?5,?6) RETURNING id`,
  ).bind(deviceId, command, commandPayload(body.payload), ACTIVE_COMMAND_STATUS, now, expiresAt)
    .first<{ id: number }>();
  return json({ queued: true, id: Number(result?.id), deviceId, command, expiresAt }, { status: 202 });
}

export async function getDeviceCommands(request: Request, env: Env): Promise<Response> {
  const deviceId = deviceIdFrom(request);
  if (!validDeviceId(deviceId)) return json({ error: "valid deviceId is required" }, { status: 400 });
  const now = nowMs();
  const rows = await env.DB.prepare(
    `SELECT id,command,payload,created_at,expires_at,attempts
       FROM device_commands
      WHERE device_id=?1 AND status=?2 AND (expires_at IS NULL OR expires_at>?3)
        AND (leased_until IS NULL OR leased_until<?3)
        AND attempts<?4
      ORDER BY id ASC LIMIT 20`,
  ).bind(deviceId, ACTIVE_COMMAND_STATUS, now, MAX_COMMAND_ATTEMPTS).all<{
    id: number; command: string; payload: string | null; created_at: number; expires_at: number | null; attempts: number;
  }>();
  const commands = (rows.results ?? []).map(row => ({
    id: Number(row.id),
    command: row.command,
    payload: safeJson(row.payload),
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    attempts: Number(row.attempts),
  }));
  if (commands.length) {
    const placeholders = commands.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE device_commands SET leased_until=?1, attempts=attempts+1 WHERE id IN (${placeholders})`,
    ).bind(now + ACKNOWLEDGEMENT_LEASE_MS, ...commands.map(command => command.id)).run();
  }
  return json({ deviceId, commands });
}

export async function acknowledgeDeviceCommand(request: Request, env: Env): Promise<Response> {
  const deviceId = deviceIdFrom(request);
  if (!validDeviceId(deviceId)) return json({ error: "valid deviceId is required" }, { status: 400 });
  let body: { id?: unknown; success?: unknown; result?: unknown };
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, { status: 400 }); }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "valid command id is required" }, { status: 400 });
  const success = body.success === true;
  const result = typeof body.result === "string" ? body.result.slice(0, 1000) : null;
  const now = nowMs();
  const updated = await env.DB.prepare(
    `UPDATE device_commands SET status=?1,result=?2,completed_at=?3,leased_until=NULL
      WHERE id=?4 AND device_id=?5 AND status=?6`,
  ).bind(success ? "completed" : "failed", result, now, id, deviceId, ACTIVE_COMMAND_STATUS).run();
  return json({ acknowledged: Number(updated.meta.changes ?? 0) === 1, id, success });
}

interface SyncRow {
  kind: string;
  source: string | null;
  version: number | null;
  payload: string | null;
  content_hash: string | null;
  updated_at: number | null;
  pending: number | null;
}

async function pendingCommands(env: Env, deviceId: string, now: number): Promise<Record<string, unknown>[]> {
  const rows = await env.DB.prepare(
    `SELECT id,command,payload,created_at,expires_at,attempts
       FROM device_commands
      WHERE device_id=?1 AND status=?2 AND (expires_at IS NULL OR expires_at>?3)
        AND (leased_until IS NULL OR leased_until<?3)
        AND attempts<?4
      ORDER BY id ASC LIMIT 20`,
  ).bind(deviceId, ACTIVE_COMMAND_STATUS, now, MAX_COMMAND_ATTEMPTS).all<{
    id: number; command: string; payload: string | null; created_at: number; expires_at: number | null; attempts: number;
  }>();
  const commands = (rows.results ?? []).map(row => ({
    id: Number(row.id), command: row.command, payload: safeJson(row.payload), createdAt: Number(row.created_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at), attempts: Number(row.attempts),
  }));
  if (commands.length) {
    const placeholders = commands.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE device_commands SET leased_until=?1, attempts=attempts+1 WHERE id IN (${placeholders})`,
    ).bind(now + ACKNOWLEDGEMENT_LEASE_MS, ...commands.map(command => Number(command.id))).run();
  }
  return commands;
}

function requestedVersions(request: Request): Record<string, number> {
  const search = new URL(request.url).searchParams;
  const value = (name: string): number => {
    const parsed = Number(search.get(name));
    return Number.isFinite(parsed) ? parsed : -1;
  };
  return {
    dashboard: value("dashboardVersion"),
    radar: value("radarVersion"),
    switchbot: value("switchbotVersion"),
    stationhead: value("stationheadVersion"),
    config: value("configVersion"),
  };
}

function dashboardVersion(states: Record<string, SyncRow>): number {
  const dashboard = states.dashboard;
  const radar = states.radar;
  const weather = states.weather;
  const news = states.news;
  const octopus = states.octopus;
  const seed = [dashboard?.version, radar?.version, weather?.version, news?.version, octopus?.version]
    .map(value => Number(value ?? 0)).join(":");
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dashboardPayload(states: Record<string, SyncRow>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const source of ["weather", "news", "octopus"] as const) {
    const row = states[source];
    if (!row?.payload) continue;
    try { payload[source] = JSON.parse(row.payload); } catch { /* omit invalid source */ }
  }
  const dashboard = states.dashboard;
  if (dashboard?.payload) {
    try { Object.assign(payload, JSON.parse(dashboard.payload)); } catch { /* retain partial */ }
  }
  return payload;
}

export async function getDeviceSync(request: Request, env: Env): Promise<Response> {
  const deviceId = deviceIdFrom(request);
  if (!validDeviceId(deviceId)) return json({ error: "valid deviceId is required" }, { status: 400 });
  if (!authorizedAnyDevice(request, env)) return json({ error: "unauthorized" }, { status: 401 });
  await ensureDashboard(env);
  const requested = requestedVersions(request);
  const now = nowMs();
  const rows = await env.DB.prepare(
    `SELECT 'state' AS kind,source,version,payload,content_hash,fetched_at AS updated_at,NULL AS pending
       FROM current_state WHERE source IN ('dashboard','radar','weather','news','octopus','switchbot','stationhead')
     UNION ALL
     SELECT 'config' AS kind,NULL AS source,version,payload,NULL AS content_hash,updated_at,NULL AS pending
       FROM device_configs WHERE device_id=?1
     UNION ALL
     SELECT 'commands' AS kind,NULL AS source,NULL AS version,NULL AS payload,NULL AS content_hash,NULL AS updated_at,
       EXISTS(SELECT 1 FROM device_commands WHERE device_id=?1 AND status=?2
              AND (expires_at IS NULL OR expires_at>?3)
              AND (leased_until IS NULL OR leased_until<?3)
              AND attempts<?4) AS pending`,
  ).bind(deviceId, ACTIVE_COMMAND_STATUS, now, MAX_COMMAND_ATTEMPTS).all<SyncRow>();
  const states: Record<string, SyncRow> = {};
  for (const row of rows.results ?? []) {
    if (row.kind === "state" && row.source) states[row.source] = row;
  }
  const configRow = rows.find(row => row.kind === "config");
  const configVersion = Number(configRow?.version ?? 0);
  const hasPendingCommands = Number(rows.find(row => row.kind === "commands")?.pending ?? 0) === 1;
  const commands = hasPendingCommands ? await pendingCommands(env, deviceId, now) : [];
  const currentDashboardVersion = dashboardVersion(states);
  const radarVersion = Number(states.radar?.version ?? 0);
  const switchbotVersion = Number(states.switchbot?.version ?? 0);
  const stationheadVersion = Number(states.stationhead?.version ?? 0);
  const response: Record<string, unknown> = {
    workerVersion: WORKER_VERSION,
    versions: {
      dashboard: currentDashboardVersion,
      radar: radarVersion,
      switchbot: switchbotVersion,
      stationhead: stationheadVersion,
      config: configVersion,
    },
    commands,
  };
  if (currentDashboardVersion !== requested.dashboard) {
    response.dashboard = JSON.stringify(dashboardPayload(states));
  }
  for (const source of ["radar", "switchbot", "stationhead"] as const) {
    const row = states[source];
    const requestedSourceVersion = requested[source];
    if (row && row.version !== requestedSourceVersion) response[source] = row.payload;
  }
  if (configVersion !== requested.config) {
    let value: unknown = {};
    try { value = configRow?.payload ? JSON.parse(configRow.payload) : {}; } catch { value = {}; }
    response.deviceConfig = JSON.stringify({
      deviceId,
      version: configVersion,
      updatedAt: Number(configRow?.updated_at ?? 0),
      config: value,
    });
  }
  return json(response);
}
