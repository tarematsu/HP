import { fetchJson } from "./http";
import {
  renderRepresentativeRadarFrame,
  type BrowserRadarCandidate,
  type BrowserRadarPanelRequest,
  type BrowserRadarTile,
} from "./radar_browser_frame";
import { signedRadarTilePath } from "./radar_tile";
import type { Env, SourceResult } from "./sources";

const DEFAULT_RADAR_CENTER = { lat: 35.8923181, lon: 139.4858691 };
const DEFAULT_RADAR_ZOOM = 10;
const RADAR_DISPLAY_ZOOM_OFFSET = 1;
const RADAR_SELECTION_MAX_ZOOM = 8;
const RADAR_TILE_URL_LIFETIME_SECONDS = 30 * 60;
const RADAR_FORECAST_WINDOW_MS = 60 * 60 * 1000;
const RADAR_TERMINAL_WINDOW_MS = 2 * 60 * 60 * 1000;
const RADAR_FRAME_PREFIX = "radar/frames/representative/";
const RADAR_PANEL_SOURCE_WIDTH = 384;
const RADAR_PANEL_SOURCE_HEIGHT = 512;
const RADAR_OUTPUT_WIDTH = 1920;
const RADAR_OUTPUT_HEIGHT = 1280;
const RADAR_LEGEND = [0, 1, 2, 4, 8, 16, 32, 64] as const;
const RADAR_FRAME_PATH = "/v1/radar/frame/representative/latest.png";
const RADAR_LEGACY_FRAME_PREFIX = "radar/frames/";
const RADAR_LEGACY_FRAME_PATH = /^\/v1\/radar\/frame\/([a-z0-9-]{1,96})\/(\d{14})\.webp$/;
const JMA_OBSERVED_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
const JMA_FORECAST_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json";
const JMA_SHORT_TERM_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/rasrf/targetTimes.json";

export type RadarTimeEntry = {
  basetime: string;
  validtime: string;
  member?: string;
  elements?: string[];
};

type RadarProduct = "jma" | "rasrf";
type RadarTileLayout = { x: number; y: number; destX: number; destY: number };

function jmaTimestampToMillis(value: string): number {
  if (!/^\d{14}$/.test(value)) return 0;
  return Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(12, 14)),
  );
}

function hasElement(entry: RadarTimeEntry, element: string): boolean {
  return entry.elements?.includes(element) === true;
}

export function selectRadarForecastEntries(
  observed: RadarTimeEntry[],
  forecast: RadarTimeEntry[],
): RadarTimeEntry[] {
  const forecastAvailable = forecast.filter(entry => (
    hasElement(entry, "hrpns") && jmaTimestampToMillis(entry.validtime) > 0
  ));
  const forecastBaseTimes = new Set(forecastAvailable.map(entry => entry.basetime));
  const current = observed
    .filter(entry => (
      hasElement(entry, "hrpns")
      && entry.basetime === entry.validtime
      && forecastBaseTimes.has(entry.basetime)
      && jmaTimestampToMillis(entry.validtime) > 0
    ))
    .sort((left, right) => right.validtime.localeCompare(left.validtime))[0];
  if (!current) return [];

  const currentAt = jmaTimestampToMillis(current.validtime);
  const forecastEnd = currentAt + RADAR_FORECAST_WINDOW_MS;
  const futureByValidTime = new Map<string, RadarTimeEntry>();
  for (const entry of forecastAvailable) {
    const validAt = jmaTimestampToMillis(entry.validtime);
    if (entry.basetime === current.basetime && validAt > currentAt && validAt <= forecastEnd) {
      futureByValidTime.set(entry.validtime, entry);
    }
  }
  const future = [...futureByValidTime.values()]
    .sort((left, right) => left.validtime.localeCompare(right.validtime));
  return future.length ? [current, ...future] : [];
}

export function selectTerminalForecastEntries(entries: RadarTimeEntry[]): RadarTimeEntry[] {
  const available = entries.filter(entry => (
    hasElement(entry, "rasrf") && jmaTimestampToMillis(entry.validtime) > 0
  ));
  if (!available.length) return [];

  const terminal = available.reduce((best, entry) => {
    if (entry.validtime !== best.validtime) return entry.validtime > best.validtime ? entry : best;
    return entry.basetime > best.basetime ? entry : best;
  });
  const terminalAt = jmaTimestampToMillis(terminal.validtime);
  const startAt = terminalAt - RADAR_TERMINAL_WINDOW_MS;
  const byValidTime = new Map<string, RadarTimeEntry>();
  for (const entry of available) {
    const validAt = jmaTimestampToMillis(entry.validtime);
    if (entry.basetime === terminal.basetime
        && entry.member === terminal.member
        && validAt >= startAt
        && validAt <= terminalAt) {
      byValidTime.set(entry.validtime, entry);
    }
  }
  return [...byValidTime.values()]
    .sort((left, right) => left.validtime.localeCompare(right.validtime));
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
  const output: RadarTileLayout[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      output.push({ x, y, destX: Math.round(x * 256 - left), destY: Math.round(y * 256 - top) });
    }
  }
  return output;
}

function envNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
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

function radarTilePath(product: RadarProduct, entry: RadarTimeEntry, zoom: number, tile: RadarTileLayout): string {
  return `/v1/radar/tile/${product}/${entry.basetime}/${entry.validtime}/${zoom}/${tile.x}/${tile.y}.png`;
}

function representativeFrameKey(): string {
  return `${RADAR_FRAME_PREFIX}latest.png`;
}

function representativeFramePath(): string {
  return RADAR_FRAME_PATH;
}

async function signedBrowserTiles(
  env: Env,
  product: RadarProduct,
  entry: RadarTimeEntry,
  zoom: number,
  layout: readonly RadarTileLayout[],
  expires: number,
): Promise<BrowserRadarTile[]> {
  return Promise.all(layout.map(async tile => ({
    destX: tile.destX,
    destY: tile.destY,
    url: await signedRadarTilePath(env, radarTilePath(product, entry, zoom, tile), expires),
  })));
}

function jstTimeText(entry: RadarTimeEntry): string {
  const date = new Date(jmaTimestampToMillis(entry.validtime) + 9 * 60 * 60 * 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}

async function panelRequest(
  env: Env,
  title: string,
  product: RadarProduct,
  entries: RadarTimeEntry[],
  displayZoom: number,
  selectionZoom: number,
  displayLayout: RadarTileLayout[],
  selectionLayout: RadarTileLayout[],
  selectionWidth: number,
  selectionHeight: number,
  expires: number,
): Promise<BrowserRadarPanelRequest> {
  const candidates: BrowserRadarCandidate[] = await Promise.all(entries.map(async (entry, index) => ({
    index,
    tiles: await signedBrowserTiles(env, product, entry, selectionZoom, selectionLayout, expires),
  })));
  return {
    title,
    candidates,
    displayTiles: index => signedBrowserTiles(
      env, product, entries[index]!, displayZoom, displayLayout, expires,
    ),
    selectionWidth,
    selectionHeight,
    sourceWidth: RADAR_PANEL_SOURCE_WIDTH,
    sourceHeight: RADAR_PANEL_SOURCE_HEIGHT,
    validTimeText: index => jstTimeText(entries[index]!),
  };
}

export async function radarFrameResponse(pathname: string, env: Env): Promise<Response> {
  if (!env.UPDATE_BUCKET) return new Response(null, { status: 404 });
  const representative = pathname === RADAR_FRAME_PATH;
  const legacy = pathname.match(RADAR_LEGACY_FRAME_PATH);
  const key = representative
    ? representativeFrameKey()
    : legacy
      ? `${RADAR_LEGACY_FRAME_PREFIX}${legacy[1]}/${legacy[2]}.webp`
      : "";
  if (!key) return new Response(null, { status: 404 });
  const object = await env.UPDATE_BUCKET.get(key);
  if (!object?.body) return new Response(null, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", representative ? "image/png" : "image/webp");
  headers.set("Cache-Control", representative ? "private, no-cache" : "private, max-age=10800, immutable");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}

export async function fetchRadar(env: Env): Promise<SourceResult> {
  const [observed, forecast, shortTerm] = await Promise.all([
    fetchJson<RadarTimeEntry[]>(JMA_OBSERVED_TIMES_URL),
    fetchJson<RadarTimeEntry[]>(JMA_FORECAST_TIMES_URL),
    fetchJson<RadarTimeEntry[]>(JMA_SHORT_TERM_TIMES_URL),
  ]);
  const currentEntries = selectRadarForecastEntries(observed, forecast);
  const terminalEntries = selectTerminalForecastEntries(shortTerm);
  if (currentEntries.length < 2) throw new Error("JMA current-to-60-minute radar frames are unavailable");
  if (!terminalEntries.length) throw new Error("JMA terminal short-term radar frames are unavailable");
  if (!env.UPDATE_BUCKET) throw new Error("UPDATE_BUCKET is required for radar cloud composition");

  const configuredZoom = Math.trunc(envNumber(env.RADAR_ZOOM, DEFAULT_RADAR_ZOOM, 4, 14));
  const displayZoom = Math.max(4, configuredZoom - RADAR_DISPLAY_ZOOM_OFFSET);
  const selectionZoom = Math.min(displayZoom, RADAR_SELECTION_MAX_ZOOM);
  const selectionScale = 2 ** (displayZoom - selectionZoom);
  const selectionWidth = Math.max(1, Math.ceil(RADAR_PANEL_SOURCE_WIDTH / selectionScale));
  const selectionHeight = Math.max(1, Math.ceil(RADAR_PANEL_SOURCE_HEIGHT / selectionScale));
  const center = {
    lat: envNumber(env.RADAR_CENTER_LAT, DEFAULT_RADAR_CENTER.lat, -85.05112878, 85.05112878),
    lon: envNumber(env.RADAR_CENTER_LON, DEFAULT_RADAR_CENTER.lon, -180, 180),
  };
  const displayLayout = radarTileLayout(
    center.lat, center.lon, displayZoom, RADAR_PANEL_SOURCE_WIDTH, RADAR_PANEL_SOURCE_HEIGHT,
  );
  const selectionLayout = radarTileLayout(
    center.lat, center.lon, selectionZoom, selectionWidth, selectionHeight,
  );
  const expires = Math.floor(Date.now() / 1000) + RADAR_TILE_URL_LIFETIME_SECONDS;
  const panels = await Promise.all([
    panelRequest(
      env, "現在〜1時間", "jma", currentEntries, displayZoom, selectionZoom,
      displayLayout, selectionLayout, selectionWidth, selectionHeight, expires,
    ),
    panelRequest(
      env, "予報終端±2時間", "rasrf", terminalEntries, displayZoom, selectionZoom,
      displayLayout, selectionLayout, selectionWidth, selectionHeight, expires,
    ),
  ]) as [BrowserRadarPanelRequest, BrowserRadarPanelRequest];

  const rendered = await renderRepresentativeRadarFrame(env, {
    publicUrl: publicWorkerUrl(env),
    outputWidth: RADAR_OUTPUT_WIDTH,
    outputHeight: RADAR_OUTPUT_HEIGHT,
    panels,
  });
  const currentEntry = currentEntries[rendered.panels[0].selectedIndex]!;
  await env.UPDATE_BUCKET.put(representativeFrameKey(), rendered.png, {
    httpMetadata: { contentType: "image/png" },
  });

  const frame = {
    baseTime: currentEntry.basetime,
    validTime: currentEntry.validtime,
    validAt: jmaTimestampToMillis(currentEntry.validtime),
    tiles: [{ url: representativeFramePath(), destX: 0, destY: 0 }],
  };
  return {
    source: "radar",
    observedAt: jmaTimestampToMillis(currentEntries[0]!.validtime),
    payload: {
      provider: "JMA nowcast and short-term precipitation; one cloud-composited dual-panel frame",
      precomposed: true,
      bundleUrl: "",
      width: RADAR_OUTPUT_WIDTH,
      height: RADAR_OUTPUT_HEIGHT,
      outputWidth: RADAR_OUTPUT_WIDTH,
      outputHeight: RADAR_OUTPUT_HEIGHT,
      center,
      zoom: displayZoom,
      forecastWindowMs: RADAR_FORECAST_WINDOW_MS,
      frames: [frame],
      panels: [
        { title: panels[0].title, ...rendered.panels[0] },
        { title: panels[1].title, ...rendered.panels[1] },
      ],
      legend: RADAR_LEGEND,
    },
  };
}
