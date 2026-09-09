import { fetchJson } from "./http";
import {
  renderRepresentativeRadarFrame,
  type BrowserRadarCandidate,
  type BrowserRadarTile,
} from "./radar_browser_frame";
import { radarTileTargetForPath, signedRadarTilePath } from "./radar_tile";
import type { Env, SourceResult } from "./sources";

const DEFAULT_RADAR_CENTER = { lat: 35.8923181, lon: 139.4858691 };
const DEFAULT_RADAR_ZOOM = 10;
const RADAR_SELECTION_MAX_ZOOM = 8;
const RADAR_TILE_URL_LIFETIME_SECONDS = 30 * 60;
const RADAR_FORECAST_WINDOW_MS = 60 * 60 * 1000;
const RADAR_FRAME_PREFIX = "radar/frames/representative/";
const RADAR_LEGACY_FRAME_PREFIX = "radar/frames/";
const RADAR_SOURCE_WIDTH = 192;
const RADAR_SOURCE_HEIGHT = 128;
const RADAR_OUTPUT_WIDTH = 768;
const RADAR_OUTPUT_HEIGHT = 512;
const RADAR_STATUS_FETCH_CONCURRENCY = 4;
const RADAR_LEGEND = [0, 1, 2, 4, 8, 16, 32, 64] as const;
const RADAR_FRAME_PATH = /^\/v1\/radar\/frame\/representative\/(\d{14})\/(\d{14})\.png$/;
const RADAR_CLEAR_FRAME_PATH = "/v1/radar/frame/representative/clear.png";
const RADAR_LEGACY_FRAME_PATH = /^\/v1\/radar\/frame\/([a-z0-9-]{1,96})\/(\d{14})\.webp$/;
const JMA_OBSERVED_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
const JMA_FORECAST_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json";

export type RadarTimeEntry = { basetime: string; validtime: string; elements?: string[] };
type RadarTileLayout = { x: number; y: number; destX: number; destY: number };
type CandidatePresence = "clear" | "rain" | "unknown";

function jmaTimestampToMillis(value: string): number {
  if (value.length !== 14) return 0;
  const digits = new Uint8Array(14);
  for (let index = 0; index < 14; index += 1) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return 0;
    digits[index] = digit;
  }
  const pair = (at: number) => digits[at]! * 10 + digits[at + 1]!;
  const year = digits[0]! * 1000 + digits[1]! * 100 + digits[2]! * 10 + digits[3]!;
  return Date.UTC(year, pair(4) - 1, pair(6), pair(8), pair(10), pair(12));
}

function hasRadarElement(entry: RadarTimeEntry): boolean {
  return entry.elements?.includes("hrpns") === true;
}

export function selectRadarForecastEntries(
  observed: RadarTimeEntry[],
  forecast: RadarTimeEntry[],
): RadarTimeEntry[] {
  const forecastAvailable: RadarTimeEntry[] = [];
  const forecastBaseTimes = new Set<string>();
  for (const entry of forecast) {
    if (!hasRadarElement(entry) || jmaTimestampToMillis(entry.validtime) <= 0) continue;
    forecastAvailable.push(entry);
    forecastBaseTimes.add(entry.basetime);
  }

  let current: RadarTimeEntry | null = null;
  for (const entry of observed) {
    if (!hasRadarElement(entry)
        || entry.basetime !== entry.validtime
        || !forecastBaseTimes.has(entry.basetime)
        || jmaTimestampToMillis(entry.validtime) <= 0) {
      continue;
    }
    if (!current || entry.validtime.localeCompare(current.validtime) > 0) current = entry;
  }
  if (!current) return [];

  const currentAt = jmaTimestampToMillis(current.validtime);
  const forecastEnd = currentAt + RADAR_FORECAST_WINDOW_MS;
  const futureByValidTime = new Map<string, RadarTimeEntry>();
  for (const entry of forecastAvailable) {
    if (entry.basetime !== current.basetime) continue;
    const validAt = jmaTimestampToMillis(entry.validtime);
    if (validAt > currentAt && validAt <= forecastEnd) {
      futureByValidTime.set(entry.validtime, entry);
    }
  }
  const future = Array.from(futureByValidTime.values());
  future.sort((left, right) => left.validtime.localeCompare(right.validtime));
  if (!future.length) return [];
  return [current, ...future];
}

function radarTileLayout(lat: number, lon: number, zoom: number, width: number, height: number): RadarTileLayout[] {
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
  const columns = maxX - minX + 1;
  const output = new Array<RadarTileLayout>(columns * (maxY - minY + 1));
  let index = 0;
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    output[index] = { x, y, destX: Math.round(x * 256 - left), destY: Math.round(y * 256 - top) };
    index += 1;
  }
  return output;
}

function envNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function publicWorkerUrl(env: Env): string {
  const configured = env.HOMEPANEL_PUBLIC_URL?.trim() ?? "";
  if (!configured) throw new Error("HOMEPANEL_PUBLIC_URL is required for radar cloud composition");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("HOMEPANEL_PUBLIC_URL must be HTTP(S)");
  }
  return `${url.protocol}//${url.host}`;
}

function radarTilePath(entry: RadarTimeEntry, zoom: number, tile: RadarTileLayout): string {
  return `/v1/radar/tile/jma/${entry.basetime}/${entry.validtime}/${zoom}/${tile.x}/${tile.y}.png`;
}

function representativeFrameKey(baseTime: string, validTime: string): string {
  return `${RADAR_FRAME_PREFIX}${baseTime}-${validTime}.png`;
}

function clearFrameKey(): string {
  return `${RADAR_FRAME_PREFIX}clear.png`;
}

function representativeFramePath(baseTime: string, validTime: string): string {
  return `/v1/radar/frame/representative/${baseTime}/${validTime}.png`;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Math.min(values.length, Math.max(1, Math.trunc(concurrency)));
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await operation(values[index]!, index);
    }
  }));
  return results;
}

async function candidatePresence(
  entry: RadarTimeEntry,
  layout: readonly RadarTileLayout[],
  zoom: number,
): Promise<CandidatePresence> {
  const statuses = await mapWithConcurrency(layout, RADAR_STATUS_FETCH_CONCURRENCY, async tile => {
    const target = radarTileTargetForPath(radarTilePath(entry, zoom, tile));
    if (!target) return "unknown" as const;
    try {
      const response = await fetch(target.upstream, {
        headers: { "User-Agent": "HomePanel-Cloud/2.6" },
        cf: { cacheEverything: true, cacheTtl: target.ttl },
      });
      await response.body?.cancel();
      if (response.status === 404) return "clear" as const;
      if (response.ok) return "rain" as const;
      return "unknown" as const;
    } catch {
      return "unknown" as const;
    }
  });
  if (statuses.some(status => status === "rain")) return "rain";
  if (statuses.every(status => status === "clear")) return "clear";
  return "unknown";
}

async function signedBrowserTiles(
  env: Env,
  entry: RadarTimeEntry,
  zoom: number,
  layout: readonly RadarTileLayout[],
  expires: number,
): Promise<BrowserRadarTile[]> {
  return Promise.all(layout.map(async tile => ({
    destX: tile.destX,
    destY: tile.destY,
    url: await signedRadarTilePath(env, radarTilePath(entry, zoom, tile), expires),
  })));
}

async function writeRepresentativeFrame(
  env: Env,
  key: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!env.UPDATE_BUCKET) throw new Error("UPDATE_BUCKET is required for radar cloud composition");
  await env.UPDATE_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: "image/png" },
  });
}

async function ensureClearFrame(
  env: Env,
  renderRequest: Parameters<typeof renderRepresentativeRadarFrame>[1],
): Promise<void> {
  if (!env.UPDATE_BUCKET) throw new Error("UPDATE_BUCKET is required for radar cloud composition");
  const existing = await env.UPDATE_BUCKET.head(clearFrameKey());
  if (existing) return;
  const rendered = await renderRepresentativeRadarFrame(env, {
    ...renderRequest,
    candidates: [],
    forcedIndex: 0,
    displayTiles: async () => [],
  });
  await writeRepresentativeFrame(env, clearFrameKey(), rendered.png);
}

export async function radarFrameResponse(pathname: string, env: Env): Promise<Response> {
  if (!env.UPDATE_BUCKET) return new Response(null, { status: 404 });
  let key = "";
  const representative = pathname.match(RADAR_FRAME_PATH);
  if (representative) {
    key = representativeFrameKey(representative[1]!, representative[2]!);
  } else if (pathname === RADAR_CLEAR_FRAME_PATH) {
    key = clearFrameKey();
  } else {
    const legacy = pathname.match(RADAR_LEGACY_FRAME_PATH);
    if (!legacy) return new Response(null, { status: 404 });
    key = `${RADAR_LEGACY_FRAME_PREFIX}${legacy[1]}/${legacy[2]}.webp`;
  }
  const object = await env.UPDATE_BUCKET.get(key);
  if (!object?.body) return new Response(null, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", pathname.endsWith(".png") ? "image/png" : "image/webp");
  headers.set("Cache-Control", "private, max-age=10800, immutable");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}

export async function fetchRadar(env: Env): Promise<SourceResult> {
  const [observed, forecast] = await Promise.all([
    fetchJson<RadarTimeEntry[]>(JMA_OBSERVED_TIMES_URL),
    fetchJson<RadarTimeEntry[]>(JMA_FORECAST_TIMES_URL),
  ]);
  const entries = selectRadarForecastEntries(observed, forecast);
  if (entries.length < 2) throw new Error("JMA current-to-60-minute forecast frames are unavailable");
  if (!env.UPDATE_BUCKET) throw new Error("UPDATE_BUCKET is required for radar cloud composition");

  const currentAt = jmaTimestampToMillis(entries[0]!.validtime);
  const zoom = Math.trunc(envNumber(env.RADAR_ZOOM, DEFAULT_RADAR_ZOOM, 4, 14));
  const center = {
    lat: envNumber(env.RADAR_CENTER_LAT, DEFAULT_RADAR_CENTER.lat, -85.05112878, 85.05112878),
    lon: envNumber(env.RADAR_CENTER_LON, DEFAULT_RADAR_CENTER.lon, -180, 180),
  };
  const publicUrl = publicWorkerUrl(env);
  const displayLayout = radarTileLayout(
    center.lat,
    center.lon,
    zoom,
    RADAR_SOURCE_WIDTH,
    RADAR_SOURCE_HEIGHT,
  );
  const selectionZoom = Math.min(zoom, RADAR_SELECTION_MAX_ZOOM);
  const selectionScale = 2 ** (zoom - selectionZoom);
  const selectionWidth = Math.max(1, Math.ceil(RADAR_SOURCE_WIDTH / selectionScale));
  const selectionHeight = Math.max(1, Math.ceil(RADAR_SOURCE_HEIGHT / selectionScale));
  const selectionLayout = radarTileLayout(
    center.lat,
    center.lon,
    selectionZoom,
    selectionWidth,
    selectionHeight,
  );

  // A 404 from JMA means an empty transparent tile. This cheap status pass
  // avoids spending Browser Run minutes when the whole forecast window is dry.
  const presence = await mapWithConcurrency(entries, RADAR_STATUS_FETCH_CONCURRENCY, entry => (
    candidatePresence(entry, selectionLayout, selectionZoom)
  ));
  const possible = entries.map((_, index) => index).filter(index => presence[index] !== "clear");
  const noRainForecast = possible.length === 0;
  const expires = Math.floor(Date.now() / 1000) + RADAR_TILE_URL_LIFETIME_SECONDS;

  const baseRenderRequest = {
    publicUrl,
    candidates: [] as BrowserRadarCandidate[],
    displayTiles: async (_selectedIndex: number) => [] as BrowserRadarTile[],
    selectionWidth,
    selectionHeight,
    outputWidth: RADAR_OUTPUT_WIDTH,
    outputHeight: RADAR_OUTPUT_HEIGHT,
    sourceWidth: RADAR_SOURCE_WIDTH,
    sourceHeight: RADAR_SOURCE_HEIGHT,
  };

  let selectedIndex = 0;
  let selectionStrategy = "dry-window-v1";
  let rainSamples = 0;
  let intensityPoints = 0;
  let maxIntensityRank = 0;
  let score = 0;
  let framePath = RADAR_CLEAR_FRAME_PATH;

  if (noRainForecast) {
    await ensureClearFrame(env, baseRenderRequest);
  } else {
    const candidates = await Promise.all(possible.map(async index => ({
      index,
      tiles: await signedBrowserTiles(env, entries[index]!, selectionZoom, selectionLayout, expires),
    })));
    const forcedIndex = possible.length === 1 && presence[possible[0]!] === "rain"
      ? possible[0]
      : undefined;
    const rendered = await renderRepresentativeRadarFrame(env, {
      ...baseRenderRequest,
      candidates,
      ...(forcedIndex === undefined ? {} : { forcedIndex }),
      displayTiles: index => signedBrowserTiles(env, entries[index]!, zoom, displayLayout, expires),
    });
    selectedIndex = rendered.selectedIndex;
    rainSamples = rendered.rainSamples;
    intensityPoints = rendered.intensityPoints;
    maxIntensityRank = rendered.maxIntensityRank;
    score = rendered.score;
    selectionStrategy = forcedIndex === undefined
      ? "browser-weighted-coverage-intensity-v1"
      : "single-rainy-frame-v1";
    const selectedEntry = entries[selectedIndex]!;
    const key = representativeFrameKey(selectedEntry.basetime, selectedEntry.validtime);
    await writeRepresentativeFrame(env, key, rendered.png);
    framePath = representativeFramePath(selectedEntry.basetime, selectedEntry.validtime);
  }

  const selectedEntry = entries[selectedIndex]!;
  const frame = {
    baseTime: selectedEntry.basetime,
    validTime: selectedEntry.validtime,
    validAt: jmaTimestampToMillis(selectedEntry.validtime),
    tiles: [{ url: framePath, destX: 0, destY: 0 }],
  };
  const payload = {
    provider: "JMA current-to-60-minute radar forecast; one cloud-composited representative frame",
    precomposed: true,
    bundleUrl: "",
    width: RADAR_OUTPUT_WIDTH,
    height: RADAR_OUTPUT_HEIGHT,
    outputWidth: RADAR_OUTPUT_WIDTH,
    outputHeight: RADAR_OUTPUT_HEIGHT,
    center,
    zoom,
    forecastWindowMs: RADAR_FORECAST_WINDOW_MS,
    noRainForecast,
    selection: {
      strategy: selectionStrategy,
      scoringZoom: selectionZoom,
      candidateCount: entries.length,
      evaluatedCandidateCount: possible.length,
      rainSamples,
      intensityPoints,
      maxIntensityRank,
      score,
    },
    frames: [frame],
    legend: RADAR_LEGEND,
  };
  return {
    source: "radar",
    payload,
    observedAt: currentAt,
  };
}
