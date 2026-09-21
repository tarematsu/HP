import type { Env } from "./sources";

const MAX_RECORDS = 8;
const MAX_BODY_CHARS = 65_536;
const MAX_REPORT_BODY_CHARS = 24_576;
const MAX_REPORT_PREVIEW_CHARS = 768;
const MAX_URL_CHARS = 2_000;
const MAX_PAGE_CHARS = 1_000;
const MAX_CONTENT_TYPE_CHARS = 160;
const HISTORY_PREFIX = "diagnostics/stationhead-leaderboard/history/";
const LATEST_KEY = "diagnostics/stationhead-leaderboard/latest.json";
const SECRET_KEY = /authorization|token|secret|password|cookie|device.?uid|session/i;
const SECRET_QUERY = /authorization|token|auth|code|key|secret|password|cookie|device.?uid|session|signature/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

export interface StationheadLeaderboardProbeRecord {
  observed_at: number;
  source: string;
  page: string;
  url: string;
  method: string;
  status: number;
  content_type: string;
  body: string;
}

export interface StationheadLeaderboardProbeResult {
  status: number;
  body: Record<string, unknown>;
}

function stationheadUrl(value: unknown, maximum: number): string | null {
  const raw = String(value ?? "").trim().slice(0, maximum);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "stationhead.com" && !host.endsWith(".stationhead.com"))) {
      return null;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString().slice(0, maximum);
  } catch {
    return null;
  }
}

function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth-limit]";
  if (Array.isArray(value)) return value.slice(0, 500).map(item => redactJson(item, depth + 1));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? value.replace(BEARER, "Bearer [redacted]") : value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
    output[key] = SECRET_KEY.test(key) ? "[redacted]" : redactJson(item, depth + 1);
  }
  return output;
}

function redactBody(value: unknown): string {
  const raw = String(value ?? "").slice(0, MAX_BODY_CHARS);
  if (!raw) return "";
  try {
    return JSON.stringify(redactJson(JSON.parse(raw))).slice(0, MAX_BODY_CHARS);
  } catch {
    return raw.replace(BEARER, "Bearer [redacted]").slice(0, MAX_BODY_CHARS);
  }
}

export function normalizeStationheadLeaderboardProbe(
  value: unknown,
  now = Date.now(),
): StationheadLeaderboardProbeRecord[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECORDS) return null;
  const records: StationheadLeaderboardProbeRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const input = raw as Record<string, unknown>;
    const observed = Number(input.observed_at);
    if (!Number.isSafeInteger(observed) || observed < now - 7 * 86_400_000 || observed > now + 86_400_000) {
      return null;
    }
    const source = String(input.source ?? "").trim().slice(0, 32);
    const page = stationheadUrl(input.page, MAX_PAGE_CHARS);
    const url = stationheadUrl(input.url, MAX_URL_CHARS);
    const method = String(input.method ?? "GET").trim().toUpperCase().slice(0, 16);
    const status = Number(input.status ?? 0);
    const contentType = String(input.content_type ?? "").trim().slice(0, MAX_CONTENT_TYPE_CHARS);
    if (!source || page === null || url === null || !/^[A-Z]{1,16}$/.test(method) ||
        !Number.isInteger(status) || status < 0 || status > 599) {
      return null;
    }
    records.push({
      observed_at: observed,
      source,
      page,
      url,
      method,
      status,
      content_type: contentType,
      body: redactBody(input.body),
    });
  }
  return records;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function bestRecord(records: StationheadLeaderboardProbeRecord[]): StationheadLeaderboardProbeRecord {
  return [...records].sort((left, right) => {
    const score = (record: StationheadLeaderboardProbeRecord) =>
      (record.status >= 200 && record.status < 300 ? 8 : 0) +
      (/json/i.test(record.content_type) ? 4 : 0) +
      (record.body ? 2 : 0) +
      (record.source === "snapshot" ? 0 : 1);
    return score(right) - score(left) || right.observed_at - left.observed_at;
  })[0]!;
}

async function dispatchProbeReport(
  env: Env,
  receivedAt: number,
  records: StationheadLeaderboardProbeRecord[],
  historyKey: string,
): Promise<boolean> {
  const token = env.GITHUB_RADAR_DISPATCH_TOKEN?.trim();
  if (!token) return false;
  const record = bestRecord(records);
  const payload = {
    version: 1,
    received_at: new Date(receivedAt).toISOString(),
    records: records.length,
    history_key: historyKey,
    candidates: records.map(item => ({
      source: item.source,
      url: item.url,
      method: item.method,
      status: item.status,
      content_type: item.content_type,
      body_chars: item.body.length,
      body_preview: item.body.slice(0, MAX_REPORT_PREVIEW_CHARS),
    })),
    best: {
      source: record.source,
      url: record.url,
      method: record.method,
      status: record.status,
      content_type: record.content_type,
      body: record.body.slice(0, MAX_REPORT_BODY_CHARS),
      body_chars: record.body.length,
    },
  };
  try {
    const response = await fetch("https://api.github.com/repos/tarematsu/HP/dispatches", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "homepanel-cloud",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        event_type: "stationhead-leaderboard-probe",
        client_payload: payload,
      }),
    });
    const reported = response.status === 204;
    if (!reported) {
      console.error("stationhead-leaderboard-probe-dispatch-failed", { status: response.status });
      await response.body?.cancel();
    }
    return reported;
  } catch (error) {
    console.error("stationhead-leaderboard-probe-dispatch-failed", {
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
    return false;
  }
}

export async function applyStationheadLeaderboardProbeInput(
  value: unknown,
  env: Env,
  deviceId: string,
): Promise<StationheadLeaderboardProbeResult> {
  if (!env.DATA_BUCKET) return { status: 503, body: { error: "probe storage unavailable" } };
  const receivedAt = Date.now();
  const records = normalizeStationheadLeaderboardProbe(value, receivedAt);
  if (!records) return { status: 400, body: { error: "invalid leaderboard probe" } };

  const identity = JSON.stringify({ version: 1, device_id: deviceId, records });
  const digest = await sha256Hex(identity);
  const historyKey = `${HISTORY_PREFIX}${digest.slice(0, 32)}.json`;
  const storedPayload = {
    version: 1,
    device_id: deviceId,
    received_at: receivedAt,
    digest,
    records,
  };
  const serialized = JSON.stringify(storedPayload);
  await Promise.all([
    env.DATA_BUCKET.put(historyKey, serialized, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    }),
    env.DATA_BUCKET.put(LATEST_KEY, serialized, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    }),
  ]);

  const reported = await dispatchProbeReport(env, receivedAt, records, historyKey);
  return {
    status: 200,
    body: {
      accepted: records.length,
      stored: true,
      reported,
      historyKey,
    },
  };
}
