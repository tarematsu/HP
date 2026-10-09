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
const RADAR_DISPLAY_ZOOM = 10;
const RADAR_TILE_URL_LIFETIME_SECONDS = 30 * 60;
const RADAR_FRAME_PREFIX = "radar/frames/representative/";
const RADAR_PANEL_SOURCE_WIDTH = 432;
const RADAR_PANEL_SOURCE_HEIGHT = 729;
const RADAR_BASE_CROP_WIDTH = 432;
const RADAR_BASE_CROP_HEIGHT = 729;
const RADAR_OUTPUT_WIDTH = 640;
const RADAR_OUTPUT_HEIGHT = 360;
const RADAR_COMPOSITION_VERSION = "radar-frame-v14-z10-640x360-downsampled-next22-next09-nowcast";
const RADAR_LEGEND = [0, 1, 2, 4, 8, 16, 32, 64] as const;
const RADAR_FRAME_PATH = "/v1/radar/frame/representative/latest.png";
const RADAR_LEGACY_FRAME_PREFIX = "radar/frames/";
const RADAR_LEGACY_FRAME_PATH = /^\/v1\/radar\/frame\/([a-z0-9-]{1,96})\/(\d{14})\.webp$/;
const JMA_OBSERVED_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
const JMA_NOWCAST_FORECAST_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json";
const JMA_SHORT_TERM_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/rasrf/targetTimes.json";

export type RadarTimeEntry = {
  basetime: string;
  validtime: string;
  member?: string;
  elements?: string[];
};

type RadarProduct = "jma" | "rasrf";
type RadarTileLayout = { x: number; y: number; destX: number; destY: number };
type RadarViewport = { worldLeft: number; worldTop: number; zoom: number };

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

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function selectLatestObservedRadarEntry(entries: RadarTimeEntry[]): RadarTimeEntry | undefined {
  return entries
    .filter(entry => (
      hasElement(entry, "hrpns")
      && entry.basetime === entry.validtime
      && jmaTimestampToMillis(entry.validtime) > 0
    ))
    .sort((left, right) => right.validtime.localeCompare(left.validtime))[0];
}

/** The next occurrence strictly after referenceAt, regardless of month/year boundaries. */
export function nextJstRadarTargetMillis(referenceAt: number, hour: 9 | 22): number {
  const date = new Date(referenceAt + JST_OFFSET_MS);
  let targetAt = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
  ) - JST_OFFSET_MS;
  if (targetAt <= referenceAt) targetAt += DAY_MS;
  return targetAt;
}

/** Prefer the exact next JST clock hour; use the latest published valid time if absent. */
export function selectNextShortTermEntry(
  entries: RadarTimeEntry[],
  hour: 9 | 22,
  referenceAt: number,
): RadarTimeEntry | undefined {
  const available = entries.filter(entry => (
    hasElement(entry, "rasrf")
    && (entry.member === undefined || entry.member === "none")
    && jmaTimestampToMillis(entry.basetime) > 0
    && jmaTimestampToMillis(entry.validtime) > 0
  ));
  const targetAt = nextJstRadarTargetMillis(referenceAt, hour);
  const exact = available.filter(entry => jmaTimestampToMillis(entry.validtime) === targetAt);
  return (exact.length ? exact : available)
    .sort((left, right) => (
      left.validtime.localeCompare(right.validtime)
      || left.basetime.localeCompare(right.basetime)
    )).at(-1);
}

/** High-resolution JMA nowcast covers the next hour, which RASRF may not publish. */
export function selectNextNowcastEntry(
  entries: RadarTimeEntry[],
  hour: 9 | 22,
  referenceAt: number,
): RadarTimeEntry | undefined {
  const targetAt = nextJstRadarTargetMillis(referenceAt, hour);
  return entries
    .filter(entry => (
      hasElement(entry, "hrpns")
      && jmaTimestampToMillis(entry.validtime) === targetAt
      && jmaTimestampToMillis(entry.basetime) > 0
      && jmaTimestampToMillis(entry.basetime) <= referenceAt
      && jmaTimestampToMillis(entry.basetime) < targetAt
    ))
    .sort((left, right) => left.basetime.localeCompare(right.basetime))
    .at(-1);
}

/** Use an exact nowcast target before falling back to the hourly RASRF forecast. */
export function selectNextRadarForecast(
  shortTerm: RadarTimeEntry[],
  nowcast: RadarTimeEntry[],
  hour: 9 | 22,
  referenceAt: number,
): { product: RadarProduct; entry: RadarTimeEntry } | undefined {
  const nowcastEntry = selectNextNowcastEntry(nowcast, hour, referenceAt);
  if (nowcastEntry) return { product: "jma", entry: nowcastEntry };
  const shortTermEntry = selectNextShortTermEntry(shortTerm, hour, referenceAt);
  return shortTermEntry ? { product: "rasrf", entry: shortTermEntry } : undefined;
}

function radarViewport(lat: number, lon: number, zoom: number, width: number, height: number): RadarViewport {
  const scale = 2 ** zoom;
  const worldX = (lon + 180) / 360 * scale * 256;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  const worldY = (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * scale * 256;
  return {
    worldLeft: worldX - width / 2,
    worldTop: worldY - height / 2,
    zoom,
  };
}

function radarTileLayout(viewport: RadarViewport, width: number, height: number): RadarTileLayout[] {
  const left = viewport.worldLeft;
  const top = viewport.worldTop;
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

function radarCompositionKey(
  current: RadarTimeEntry,
  twentyTwo: RadarTimeEntry,
  nine: RadarTimeEntry,
  twentyTwoProduct: RadarProduct,
  nineProduct: RadarProduct,
): string {
  return [
    RADAR_COMPOSITION_VERSION,
    current.basetime,
    current.validtime,
    twentyTwoProduct,
    twentyTwo.basetime,
    twentyTwo.validtime,
    nineProduct,
    nine.basetime,
    nine.validtime,
  ].join("|");
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
  product: RadarProduct,
  entry: RadarTimeEntry,
  displayLayout: RadarTileLayout[],
  viewport: RadarViewport,
  expires: number,
): Promise<BrowserRadarPanelRequest> {
  return {
    tiles: await signedBrowserTiles(env, product, entry, RADAR_DISPLAY_ZOOM, displayLayout, expires),
    sourceWidth: RADAR_PANEL_SOURCE_WIDTH,
    sourceHeight: RADAR_PANEL_SOURCE_HEIGHT,
    baseCropWidth: RADAR_BASE_CROP_WIDTH,
    baseCropHeight: RADAR_BASE_CROP_HEIGHT,
    worldLeft: viewport.worldLeft,
    worldTop: viewport.worldTop,
    zoom: viewport.zoom,
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
  const [observed, shortTerm, nowcast] = await Promise.all([
    fetchJson<RadarTimeEntry[]>(JMA_OBSERVED_TIMES_URL),
    fetchJson<RadarTimeEntry[]>(JMA_SHORT_TERM_TIMES_URL),
    fetchJson<RadarTimeEntry[]>(JMA_NOWCAST_FORECAST_TIMES_URL).catch(() => [] as RadarTimeEntry[]),
  ]);
  const referenceAt = Date.now();
  const currentEntry = selectLatestObservedRadarEntry(observed);
  const twentyTwoForecast = selectNextRadarForecast(shortTerm, nowcast, 22, referenceAt);
  const nineForecast = selectNextRadarForecast(shortTerm, nowcast, 9, referenceAt);
  if (!currentEntry || !twentyTwoForecast || !nineForecast) {
    throw new Error("JMA latest observed or forecast radar frame is unavailable");
  }
  const twentyTwoEntry = twentyTwoForecast.entry;
  const nineEntry = nineForecast.entry;
  if (!env.UPDATE_BUCKET) throw new Error("UPDATE_BUCKET is required for radar cloud composition");

  const panelMetadata = [
    { validTimeText: jstTimeText(currentEntry) },
    { validTimeText: jstTimeText(twentyTwoEntry) },
    { validTimeText: jstTimeText(nineEntry) },
  ] as const;
  const compositionKey = radarCompositionKey(
    currentEntry, twentyTwoEntry, nineEntry, twentyTwoForecast.product, nineForecast.product,
  );
  const existingFrame = await env.UPDATE_BUCKET.head(representativeFrameKey());
  const shouldRender = existingFrame?.customMetadata?.radarCompositionKey !== compositionKey;

  if (shouldRender) {
    const center = RADAR_CENTER;
    const viewport = radarViewport(
      center.lat, center.lon, RADAR_DISPLAY_ZOOM, RADAR_PANEL_SOURCE_WIDTH, RADAR_PANEL_SOURCE_HEIGHT,
    );
    const displayLayout = radarTileLayout(
      viewport, RADAR_PANEL_SOURCE_WIDTH, RADAR_PANEL_SOURCE_HEIGHT,
    );
    const expires = Math.floor(Date.now() / 1000) + RADAR_TILE_URL_LIFETIME_SECONDS;
    const panels = await Promise.all([
      panelRequest(env, "jma", currentEntry, displayLayout, viewport, expires),
      panelRequest(env, twentyTwoForecast.product, twentyTwoEntry, displayLayout, viewport, expires),
      panelRequest(env, nineForecast.product, nineEntry, displayLayout, viewport, expires),
    ]) as [
      BrowserRadarPanelRequest,
      BrowserRadarPanelRequest,
      BrowserRadarPanelRequest,
    ];

    const rendered = await renderRepresentativeRadarFrame(env, {
      publicUrl: publicWorkerUrl(env),
      outputWidth: RADAR_OUTPUT_WIDTH,
      outputHeight: RADAR_OUTPUT_HEIGHT,
      location: RADAR_CENTER,
      panels,
    });
    await env.UPDATE_BUCKET.put(representativeFrameKey(), rendered.png, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { radarCompositionKey: compositionKey },
    });
  }

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
      provider: "JMA latest observation, next 22:00 and 09:00 JST (nowcast or short-term forecast; latest available fallback); one cloud-composited representative frame",
      precomposed: true,
      bundleUrl: "",
      width: RADAR_OUTPUT_WIDTH,
      height: RADAR_OUTPUT_HEIGHT,
      outputWidth: RADAR_OUTPUT_WIDTH,
      outputHeight: RADAR_OUTPUT_HEIGHT,
      center: RADAR_CENTER,
      zoom: RADAR_DISPLAY_ZOOM,
      frames: [frame],
      panels: panelMetadata.map(panel => ({ ...panel })),
      legend: RADAR_LEGEND,
    },
  };
}
