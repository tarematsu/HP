import type { Env } from "./sources";

const MAX_RECORDS = 8;
const MAX_BODY_CHARS = 65_536;
const MAX_URL_CHARS = 2_000;
const MAX_PAGE_CHARS = 1_000;
const MAX_CONTENT_TYPE_CHARS = 160;
const HISTORY_PREFIX = "diagnostics/stationhead-leaderboard/history/";
const LATEST_KEY = "diagnostics/stationhead-leaderboard/latest.json";
const WEEKLY_PREFIX = "diagnostics/stationhead-leaderboard/weekly/";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SECRET_KEY = /authorization|token|secret|password|cookie|device.?uid|session/i;
const SECRET_QUERY = /authorization|token|auth|code|key|secret|password|cookie|device.?uid|session|signature/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

export interface StationheadLeaderboardProbeRecord { observed_at: number; source: string; page: string; url: string; method: string; status: number; content_type: string; body: string; }
export interface StationheadLeaderboardProbeResult { status: number; body: Record<string, unknown>; }

function stationheadUrl(value: unknown, maximum: number): string | null {
  const raw = String(value ?? "").trim().slice(0, maximum);
  if (!raw) return "";
  try {
    const url = new URL(raw); const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "stationhead.com" && !host.endsWith(".stationhead.com"))) return null;
    for (const key of [...url.searchParams.keys()]) if (SECRET_QUERY.test(key)) url.searchParams.set(key, "[redacted]");
    return url.toString().slice(0, maximum);
  } catch { return null; }
}
function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth-limit]";
  if (Array.isArray(value)) return value.slice(0, 500).map(item => redactJson(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.replace(BEARER, "Bearer [redacted]") : value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 500)) output[key] = SECRET_KEY.test(key) ? "[redacted]" : redactJson(item, depth + 1);
  return output;
}
function redactBody(value: unknown): string {
  const raw = String(value ?? "").slice(0, MAX_BODY_CHARS); if (!raw) return "";
  try { return JSON.stringify(redactJson(JSON.parse(raw))).slice(0, MAX_BODY_CHARS); }
  catch { return raw.replace(BEARER, "Bearer [redacted]").slice(0, MAX_BODY_CHARS); }
}
export function normalizeStationheadLeaderboardProbe(value: unknown, now = Date.now()): StationheadLeaderboardProbeRecord[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECORDS) return null;
  const records: StationheadLeaderboardProbeRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const input = raw as Record<string, unknown>; const observed = Number(input.observed_at);
    if (!Number.isSafeInteger(observed) || observed < now - 7 * 86_400_000 || observed > now + 86_400_000) return null;
    const source = String(input.source ?? "").trim().slice(0, 32); const page = stationheadUrl(input.page, MAX_PAGE_CHARS); const url = stationheadUrl(input.url, MAX_URL_CHARS);
    const method = String(input.method ?? "GET").trim().toUpperCase().slice(0, 16); const status = Number(input.status ?? 0); const contentType = String(input.content_type ?? "").trim().slice(0, MAX_CONTENT_TYPE_CHARS);
    if (!source || page === null || url === null || !/^[A-Z]{1,16}$/.test(method) || !Number.isInteger(status) || status < 0 || status > 599) return null;
    records.push({ observed_at: observed, source, page, url, method, status, content_type: contentType, body: redactBody(input.body) });
  }
  return records;
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function stableBody(body: string): unknown {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { captured_at: _capturedAt, ...stable } = parsed;
      return stable;
    }
  } catch {}
  return body;
}
function contentIdentity(deviceId: string, records: StationheadLeaderboardProbeRecord[]): string {
  return JSON.stringify({ version: 1, device_id: deviceId, records: records.map(({ observed_at: _observedAt, body, ...record }) => ({ ...record, body: stableBody(body) })) });
}
function isoDateFromShiftedJst(value: number): string {
  return new Date(value + JST_OFFSET_MS).toISOString().slice(0, 10);
}
export function stationheadLeaderboardWeekForObservedAt(observedAt: number): string | null {
  if (!Number.isSafeInteger(observedAt)) return null;
  const local = new Date(observedAt + JST_OFFSET_MS);
  const day = local.getUTCDay();
  if (day === 1 && local.getUTCHours() >= 18) return isoDateFromShiftedJst(observedAt);
  if (day !== 2) return null;
  return isoDateFromShiftedJst(observedAt - 86_400_000);
}
export function stationheadLeaderboardWeeklyCandidateKey(week: string): string {
  return `${WEEKLY_PREFIX}${week}.json`;
}
function weeklyCandidate(records: StationheadLeaderboardProbeRecord[]): { week: string; observedAt: number } | null {
  const candidates = records
    .map(record => ({ week: stationheadLeaderboardWeekForObservedAt(record.observed_at), observedAt: record.observed_at }))
    .filter((candidate): candidate is { week: string; observedAt: number } => Boolean(candidate.week))
    .sort((a, b) => a.observedAt - b.observedAt);
  return candidates.at(-1) ?? null;
}
async function putWeeklyCandidate(env: Env, candidate: { week: string; observedAt: number } | null, serialized: string, digest: string): Promise<void> {
  if (!candidate || !env.DATA_BUCKET) return;
  const key = stationheadLeaderboardWeeklyCandidateKey(candidate.week);
  const previous = await env.DATA_BUCKET.head(key);
  const previousObservedAt = Number(previous?.customMetadata?.observedAt ?? 0);
  if (Number.isFinite(previousObservedAt) && previousObservedAt > candidate.observedAt) return;
  await env.DATA_BUCKET.put(key, serialized, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      contentDigest: digest,
      observedAt: String(candidate.observedAt),
      week: candidate.week,
    },
  });
}
export async function applyStationheadLeaderboardProbeInput(value: unknown, env: Env, deviceId: string): Promise<StationheadLeaderboardProbeResult> {
  if (!env.DATA_BUCKET) return { status: 503, body: { error: "probe storage unavailable" } };
  const receivedAt = Date.now(); const records = normalizeStationheadLeaderboardProbe(value, receivedAt);
  if (!records) return { status: 400, body: { error: "invalid leaderboard probe" } };
  const digest = await sha256Hex(contentIdentity(deviceId, records));
  const historyKey = `${HISTORY_PREFIX}${digest.slice(0, 32)}.json`;
  const candidate = weeklyCandidate(records);
  const serialized = JSON.stringify({ version: 1, device_id: deviceId, received_at: receivedAt, digest, records });
  const previous = await env.DATA_BUCKET.head(LATEST_KEY);
  if (previous?.customMetadata?.contentDigest === digest) {
    await putWeeklyCandidate(env, candidate, serialized, digest);
    return { status: 200, body: { accepted: records.length, stored: false, unchanged: true, reported: true, delivery: "r2-pull", historyKey } };
  }
  const options = { httpMetadata: { contentType: "application/json; charset=utf-8" }, customMetadata: { contentDigest: digest } };
  await Promise.all([
    env.DATA_BUCKET.put(historyKey, serialized, options),
    env.DATA_BUCKET.put(LATEST_KEY, serialized, options),
    putWeeklyCandidate(env, candidate, serialized, digest),
  ]);
  return { status: 200, body: { accepted: records.length, stored: true, unchanged: false, reported: true, delivery: "r2-pull", historyKey } };
}

export async function stationheadLeaderboardLatestProbeResponse(env: Env): Promise<Response> {
  if (!env.DATA_BUCKET) return Response.json({ error: "probe storage unavailable" }, { status: 503 });
  const object = await env.DATA_BUCKET.get(LATEST_KEY);
  if (!object) return Response.json({ error: "probe unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(object.body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
