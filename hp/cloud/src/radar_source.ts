import { fetchJson } from "./http";
import {
  renderRepresentativeRadarFrame,
  type BrowserRadarPanelRequest,
  type BrowserRadarTile,
} from "./radar_browser_frame";
import { signedRadarTilePath } from "./radar_tile";
import type { Env, SourceResult } from "./sources";

const RADAR_CENTER = { lat: 35.8923181, lon: 139.4858691 };
const RADAR_BASE_ZOOM = 10;
const RADAR_DISPLAY_ZOOM = 9;
const RADAR_TILE_URL_LIFETIME_SECONDS = 30 * 60;
const RADAR_FORECAST_WINDOW_MS = 60 * 60 * 1000;
const RADAR_FRAME_PREFIX = "radar/frames/representative/";
const RADAR_PANEL_SOURCE_WIDTH = 320;
const RADAR_PANEL_SOURCE_HEIGHT = 640;
const RADAR_BASE_CROP_WIDTH = 640;
const RADAR_BASE_CROP_HEIGHT = 1280;
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

export function selectOneHourForecastEntry(entries: RadarTimeEntry[]): RadarTimeEntry | undefined {
  const current = entries[0];
  if (!current) return undefined;
  const targetAt = jmaTimestampToMillis(current.validtime) + RADAR_FORECAST_WINDOW_MS;
  return entries.find(entry => jmaTimestampToMillis(entry.validtime) === targetAt);
}

export function selectLatestShortTermEntry(entries: RadarTimeEntry[]): RadarTimeEntry | undefined {
  const available = entries.filter(entry => (
    hasElement(entry, "rasrf")
    && (entry.member === undefined || entry.member === "none")
    && jmaTimestampToMillis(entry.basetime) > 0
    && jmaTimestampToMillis(entry.validtime) > 0
  ));
  return available.sort((left, right) => (
    left.validtime.localeCompare(right.validtime)
    || left.basetime.localeCompare(right.basetime)
  )).at(-1);
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

function publicWorkerUrl(env: Env): string {
  const configured = env.HOMEPANEL_PUBLIC_URL?.trim() ?? "";
  if (!configured) throw new Error("HOMEPANEL_PUBLIC_URL is required for radar cloud composition");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("HOMEPANEL_PUBLIC_URL must be HTTP(S)");
  }
  return `${url.protocol}//${url.host}`;
}

function radarTilePath(
  product: RadarProduct,
  entry: RadarTimeEntry,
  zoom: number,
  tile: RadarTileLayout,
): string {
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
  entry: RadarTimeEntry,
  displayLayout: RadarTileLayout[],
  expires: number,
): Promise<BrowserRadarPanelRequest> {
  return {
    title,
    tiles: await signedBrowserTiles(env, product, entry, RADAR_DISPLAY_ZOOM, displayLayout, expires),
    sourceWidth: RADAR_PANEL_SOURCE_WIDTH,
    sourceHeight: RADAR_PANEL_SOURCE_HEIGHT,
    baseCropWidth: RADAR_BASE_CROP_WIDTH,
    baseCropHeight: RADAR_BASE_CROP_HEIGHT,
    validTimeText: jstTimeText(entry),
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
  const availableEntries = selectRadarForecastEntries(observed, forecast);
  const currentEntry = availableEntries[0];
  const oneHourEntry = selectOneHourForecastEntry(availableEntries);
  const latestEntry = selectLatestShortTermEntry(shortTerm);
  if (!currentEntry || !oneHourEntry || !latestEntry) {
    throw new Error("JMA current, +60-minute, or latest short-term radar frame is unavailable");
  }
  if (!env.UPDATE_BUCKET) throw new Error("UPDATE_BUCKET is required for radar cloud composition");

  // The bundled satellite and pre-generated gray-mask map are fixed z10 assets
  // centered on Kawagoe. Keep the rain geometry fixed to the same center and use
  // z9 source pixels so the geographic extent is identical while tile detail is
  // doubled compared with the previous z8 composition.
  const center = RADAR_CENTER;
  const displayLayout = radarTileLayout(
    center.lat, center.lon, RADAR_DISPLAY_ZOOM, RADAR_PANEL_SOURCE_WIDTH, RADAR_PANEL_SOURCE_HEIGHT,
  );
  const expires = Math.floor(Date.now() / 1000) + RADAR_TILE_URL_LIFETIME_SECONDS;
  const panels = await Promise.all([
    panelRequest(env, "現在", "jma", currentEntry, displayLayout, expires),
    panelRequest(env, "1時間後", "jma", oneHourEntry, displayLayout, expires),
    panelRequest(env, "取得可能な最後", "rasrf", latestEntry, displayLayout, expires),
  ]) as [
    BrowserRadarPanelRequest,
    BrowserRadarPanelRequest,
    BrowserRadarPanelRequest,
  ];

  const rendered = await renderRepresentativeRadarFrame(env, {
    publicUrl: publicWorkerUrl(env),
    outputWidth: RADAR_OUTPUT_WIDTH,
    outputHeight: RADAR_OUTPUT_HEIGHT,
    panels,
  });
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
    observedAt: jmaTimestampToMillis(currentEntry.validtime),
    payload: {
      provider: "JMA current, +60-minute nowcast, and latest short-term precipitation; one cloud-composited representative frame",
      precomposed: true,
      bundleUrl: "",
      width: RADAR_OUTPUT_WIDTH,
      height: RADAR_OUTPUT_HEIGHT,
      outputWidth: RADAR_OUTPUT_WIDTH,
      outputHeight: RADAR_OUTPUT_HEIGHT,
      center,
      zoom: RADAR_DISPLAY_ZOOM,
      forecastWindowMs: RADAR_FORECAST_WINDOW_MS,
      frames: [frame],
      panels: [
        { title: panels[0].title, ...rendered.panels[0] },
        { title: panels[1].title, ...rendered.panels[1] },
        { title: panels[2].title, ...rendered.panels[2] },
      ],
      legend: RADAR_LEGEND,
    },
  };
}
