import { fetchJson } from "./http";
import { JST_MS, type Env, type SourceResult } from "./sources";

const OCTOPUS_TOKEN_TTL_MS = 55 * 60_000;

const DEFAULT_RADAR_CENTER = { lat: 35, lon: 139 };
const DEFAULT_RADAR_ZOOM = 10;

type OctopusToken = {
  value: string;
  refresh?: string | undefined;
  expiresAt: number;
  refreshExpiresAt?: number | undefined;
};

type OctopusGraphqlIssue = {
  message?: string;
  path?: Array<string | number>;
  extensions?: {
    errorCode?: string;
    errorType?: string;
    errorDescription?: string;
    validationErrors?: unknown;
  };
};

type OctopusGraphqlResponse<T> = {
  data?: T;
  errors?: OctopusGraphqlIssue[];
};

class OctopusApiError extends Error {
  constructor(
    message: string,
    readonly codes: string[] = [],
    readonly types: string[] = [],
  ) {
    super(message);
    this.name = "OctopusApiError";
  }
}

let octopusToken: OctopusToken | null = null;

function collectErrorText(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(collectErrorText);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectErrorText);
  }
  return [];
}

function octopusApiError(context: string, issues: OctopusGraphqlIssue[] = []): OctopusApiError {
  const codes = Array.from(new Set(issues.map(issue => issue.extensions?.errorCode).filter((value): value is string => Boolean(value))));
  const types = Array.from(new Set(issues.map(issue => issue.extensions?.errorType).filter((value): value is string => Boolean(value))));
  const details = issues.map(issue => {
    const code = issue.extensions?.errorCode;
    const descriptions = [
      issue.extensions?.errorDescription,
      ...collectErrorText(issue.extensions?.validationErrors),
      issue.message,
    ].filter((value): value is string => Boolean(value));
    const description = Array.from(new Set(descriptions)).join(" / ") || "GraphQL error";
    return code ? `${code}: ${description}` : description;
  });
  return new OctopusApiError(`${context}: ${details.join("; ") || "response did not contain data"}`, codes, types);
}

function isAuthorizationError(error: unknown): boolean {
  if (!(error instanceof OctopusApiError)) return false;
  return error.types.includes("AUTHORIZATION") || error.codes.some(code => [
    "KT-CT-118", "KT-CT-1111", "KT-CT-1112", "KT-CT-4177",
  ].includes(code));
}

async function octopusGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<OctopusGraphqlResponse<T>> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", token);
  return fetchJson<OctopusGraphqlResponse<T>>("https://api.oejp-kraken.energy/v1/graphql/", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
}

function credentialInput(env: Env): Record<string, string> {
  const email = env.OCTOPUS_EMAIL?.trim();
  const password = env.OCTOPUS_PASSWORD;
  if (!email || !password) throw new Error("OCTOPUS_EMAIL or OCTOPUS_PASSWORD is not configured");
  return { email, password };
}

function normalizeRefreshExpiry(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric > 10_000_000_000 ? numeric : numeric * 1000;
}

async function requestOctopusToken(input: Record<string, string>): Promise<OctopusToken> {
  const mutation = `mutation login($input: ObtainJSONWebTokenInput!) { obtainKrakenToken(input: $input) { token refreshToken refreshExpiresIn } }`;
  const response = await octopusGraphql<{
    obtainKrakenToken?: { token?: string; refreshToken?: string; refreshExpiresIn?: number };
  }>(mutation, { input });
  const result = response.data?.obtainKrakenToken;
  if (response.errors?.length || !result?.token) {
    throw octopusApiError("Octopus authentication failed", response.errors);
  }
  return {
    value: result.token,
    refresh: result.refreshToken,
    expiresAt: Date.now() + OCTOPUS_TOKEN_TTL_MS,
    refreshExpiresAt: normalizeRefreshExpiry(result.refreshExpiresIn),
  };
}

async function authenticateOctopus(env: Env, forceCredentials = false): Promise<string> {
  if (!forceCredentials && octopusToken && Date.now() < octopusToken.expiresAt) return octopusToken.value;
  const cached = octopusToken;
  const refreshToken = !forceCredentials && cached?.refresh &&
    (!cached.refreshExpiresAt || Date.now() < cached.refreshExpiresAt)
    ? cached.refresh
    : undefined;
  if (refreshToken) {
    try {
      const refreshed = await requestOctopusToken({ refreshToken });
      const activeToken: OctopusToken = refreshed.refresh ? refreshed : {
        ...refreshed,
        refresh: refreshToken,
        refreshExpiresAt: cached?.refreshExpiresAt,
      };
      octopusToken = activeToken;
      return activeToken.value;
    } catch {
      // A stale or revoked refresh token must not block a fresh email/password login.
    }
  }
  octopusToken = await requestOctopusToken(credentialInput(env));
  return octopusToken.value;
}

function jstBoundary(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - JST_MS);
}

function jstDayKey(date: Date): string {
  const jst = new Date(date.getTime() + JST_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}`;
}

type OctopusReading = { startAt: string; value: string | number; supplyPoint: string };
type OctopusReadingPayload = {
  account?: {
    properties?: Array<{
      electricitySupplyPoints?: Array<{
        spin?: string;
        status?: string;
        halfHourlyReadings?: Array<{ startAt: string; value: string | number }>;
      }>;
    }>;
  };
};

async function fetchOctopusRangeReadings(
  accountNumber: string,
  range: { from: Date; to: Date },
  token: string,
): Promise<OctopusReading[]> {
  const queries = [
    `query readings($accountNumber: String!, $fromDatetime: DateTime, $toDatetime: DateTime) { account(accountNumber: $accountNumber) { properties(activeFrom: $fromDatetime) { electricitySupplyPoints { spin status halfHourlyReadings(fromDatetime: $fromDatetime, toDatetime: $toDatetime) { startAt value } } } } }`,
    `query readings($accountNumber: String!, $fromDatetime: DateTime, $toDatetime: DateTime) { account(accountNumber: $accountNumber) { properties { electricitySupplyPoints { spin status halfHourlyReadings(fromDatetime: $fromDatetime, toDatetime: $toDatetime) { startAt value } } } } }`,
  ];
  let lastErrors: OctopusGraphqlIssue[] = [];
  for (const query of queries) {
    const response = await octopusGraphql<OctopusReadingPayload>(query, {
      accountNumber,
      fromDatetime: range.from.toISOString(),
      toDatetime: range.to.toISOString(),
    }, token);
    const properties = response.data?.account?.properties ?? [];
    const rangeReadings = properties.flatMap((property, propertyIndex) =>
      (property.electricitySupplyPoints ?? []).flatMap((point, pointIndex) => {
        const supplyPoint = point.spin || `${propertyIndex}:${pointIndex}`;
        return (point.halfHourlyReadings ?? []).map(reading => ({ ...reading, supplyPoint }));
      }));
    if (rangeReadings.length > 0) return rangeReadings;
    lastErrors = response.errors ?? lastErrors;
    if (!response.errors?.length && response.data) break;
  }
  if (lastErrors.length) throw octopusApiError("Octopus readings failed", lastErrors);
  throw octopusApiError("Octopus readings failed");
}

async function fetchOctopusReadings(
  accountNumber: string,
  ranges: Array<{ from: Date; to: Date }>,
  token: string,
): Promise<OctopusReading[]> {
  const results = await Promise.all(ranges.map(range => fetchOctopusRangeReadings(accountNumber, range, token)));
  return results.flat();
}

export async function fetchOctopus(env: Env): Promise<SourceResult> {
  const legacyEnv = env as Env & { OCTOPUS_ACCOUNT?: string };
  const accountNumber = (env.OCTOPUS_ACCOUNT_NUMBER || legacyEnv.OCTOPUS_ACCOUNT || "").trim();
  if (!accountNumber) throw new Error("OCTOPUS_ACCOUNT or OCTOPUS_ACCOUNT_NUMBER is not configured");
  const now = new Date();
  const jst = new Date(now.getTime() + JST_MS);
  const billingMonth = jst.getUTCDate() >= 2 ? jst.getUTCMonth() : jst.getUTCMonth() - 1;
  const currentStart = jstBoundary(jst.getUTCFullYear(), billingMonth, 2);
  const previousStart = jstBoundary(jst.getUTCFullYear(), billingMonth - 1, 2);
  const nextStart = jstBoundary(jst.getUTCFullYear(), billingMonth + 1, 2);
  const ranges = [{ from: previousStart, to: currentStart }, { from: currentStart, to: now }];
  let token = await authenticateOctopus(env);
  let readings: OctopusReading[];
  try {
    readings = await fetchOctopusReadings(accountNumber, ranges, token);
  } catch (error) {
    if (!isAuthorizationError(error)) throw error;
    octopusToken = null;
    token = await authenticateOctopus(env, true);
    readings = await fetchOctopusReadings(accountNumber, ranges, token);
  }
  const seen = new Set<string>();
  const daily: Record<string, number> = {};
  const monthly = { previous: 0, current: 0 };
  let previousSlots = 0;
  for (const reading of readings) {
    const readingKey = `${reading.supplyPoint}:${reading.startAt}`;
    if (seen.has(readingKey)) continue;
    seen.add(readingKey);
    const date = new Date(reading.startAt);
    const value = Number(reading.value ?? 0);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(value)) continue;
    const key = jstDayKey(date);
    daily[key] = (daily[key] ?? 0) + value;
    if (date >= previousStart && date < currentStart) { monthly.previous += value; previousSlots += 1; }
    if (date >= currentStart && date < now) monthly.current += value;
  }
  const history = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(jstBoundary(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()).getTime() - (14 - index) * 86_400_000);
    const key = jstDayKey(date);
    return { date: key, value: daily[key] === undefined ? null : Number(daily[key].toFixed(3)) };
  });
  const elapsed = Math.max(1, now.getTime() - currentStart.getTime());
  const duration = Math.max(1, nextStart.getTime() - currentStart.getTime());
  const projected = monthly.current * duration / elapsed;
  const expectedSlots = Math.round((currentStart.getTime() - previousStart.getTime()) / 86_400_000) * 48;
  return {
    source: "octopus",
    payload: {
      history,
      lastMonth: { usage: Number(monthly.previous.toFixed(3)), complete: previousSlots / Math.max(1, expectedSlots) >= 0.95, coveredSlots: previousSlots, expectedSlots },
      thisMonth: { usageToDate: Number(monthly.current.toFixed(3)), projectedUsage: Number(projected.toFixed(3)) },
    },
    observedAt: now.getTime(),
  };
}

function jmaTimestampToMillis(value: string): number {
  if (!/^\d{14}$/.test(value)) return 0;
  return Date.UTC(
    Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)),
    Number(value.slice(8, 10)), Number(value.slice(10, 12)), Number(value.slice(12, 14)),
  );
}

function radarTileLayout(lat: number, lon: number, zoom: number, width: number, height: number): Array<{ x: number; y: number; destX: number; destY: number }> {
  const scale = 2 ** zoom;
  const worldX = (lon + 180) / 360 * scale * 256;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  const worldY = (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * scale * 256;
  const left = worldX - width / 2;
  const top = worldY - height / 2;
  const minX = Math.floor(left / 256);
  const maxX = Math.floor((left + width - 1) / 256);
  const minY = Math.floor(top / 256);
  const maxY = Math.floor((top + height - 1) / 256);
  const output: Array<{ x: number; y: number; destX: number; destY: number }> = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    output.push({ x, y, destX: Math.round(x * 256 - left), destY: Math.round(y * 256 - top) });
  }
  return output;
}

function envNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export async function fetchRadar(env: Env): Promise<SourceResult> {
  type TimeEntry = { basetime: string; validtime: string; elements?: string[] };
  const [observed, forecast] = await Promise.all([
    fetchJson<TimeEntry[]>("https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json"),
    fetchJson<TimeEntry[]>("https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json"),
  ]);
  const current = observed.find(entry => entry.elements?.includes("hrpns"));
  if (!current) throw new Error("JMA nowcast current frame is unavailable");
  const width = 400, height = 260;
  const zoom = Math.trunc(envNumber(env.RADAR_ZOOM, DEFAULT_RADAR_ZOOM, 4, 14));
  const center = {
    lat: envNumber(env.RADAR_CENTER_LAT, DEFAULT_RADAR_CENTER.lat, -85.05112878, 85.05112878),
    lon: envNumber(env.RADAR_CENTER_LON, DEFAULT_RADAR_CENTER.lon, -180, 180),
  };
  const layout = radarTileLayout(center.lat, center.lon, zoom, width, height);
  const entries = [current, ...forecast
    .filter(entry => entry.elements?.includes("hrpns") && entry.basetime === current.basetime && jmaTimestampToMillis(entry.validtime) > jmaTimestampToMillis(current.validtime))
    .sort((a, b) => a.validtime.localeCompare(b.validtime))]
    .slice(0, 13);
  const frames = entries.map(entry => ({
    baseTime: entry.basetime,
    validTime: entry.validtime,
    validAt: jmaTimestampToMillis(entry.validtime),
    tiles: layout.map(tile => ({
      ...tile,
      url: `/v1/radar/tile/jma/${entry.basetime}/${entry.validtime}/${zoom}/${tile.x}/${tile.y}.png`,
    })),
  }));
  const baseTiles = layout.map(tile => ({
    ...tile,
    url: `/v1/radar/tile/gsi/${zoom}/${tile.x}/${tile.y}.png`,
  }));
  return {
    source: "radar",
    payload: {
      provider: "JMA High-resolution Precipitation Nowcast via Cloudflare Cache",
      width,
      height,
      center,
      zoom,
      frameIntervalMs: 1000,
      playbackRate: 0.5,
      baseTiles,
      frames,
      legend: [0, 1, 2, 4, 8, 16, 32, 64],
    },
    observedAt: Date.now(),
  };
}
