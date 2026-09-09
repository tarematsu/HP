import { fetchJson } from "./http";
import { emptyRadarFrameScore, compareRadarFrameScores, mergeRadarFrameScores, scoreRadarPng, type RadarFrameScore, type RadarPixelArea } from "./radar_intensity";
import { prewarmRadarBundle } from "./radar_bundle_prewarm";
import { radarTileTargetForPath, signedRadarTilePath } from "./radar_tile";
import type { Env, SourceResult } from "./sources";

const DEFAULT_RADAR_CENTER = { lat: 35.8923181, lon: 139.4858691 };
const DEFAULT_RADAR_ZOOM = 10;
const RADAR_SELECTION_MAX_ZOOM = 8;
const RADAR_TILE_URL_LIFETIME_SECONDS = 30 * 60;
const RADAR_FORECAST_WINDOW_MS = 60 * 60 * 1000;
const RADAR_FRAME_INTERVAL_MS = 1_000;
const RADAR_FRAME_PREFIX = "radar/frames/";
const RADAR_SCORE_FETCH_CONCURRENCY = 4;
// The former viewport was 480x320 logical pixels. Keep only its centered 40%
// so the cloud bundle never signs, prewarms, downloads, or ships outer tiles
// that the compact native radar panel cannot display.
const RADAR_SOURCE_WIDTH = 192;
const RADAR_SOURCE_HEIGHT = 128;
const RADAR_OUTPUT_WIDTH = 1920;
const RADAR_OUTPUT_HEIGHT = 1280;
const RADAR_LEGEND = [0, 1, 2, 4, 8, 16, 32, 64] as const;
const RADAR_FRAME_PATH = /^\/v1\/radar\/frame\/([a-z0-9-]{1,96})\/(\d{14})\.webp$/;
const JMA_OBSERVED_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
const JMA_FORECAST_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json";

export type RadarTimeEntry = { basetime: string; validtime: string; elements?: string[] };
type RadarTileLayout = { x: number; y: number; destX: number; destY: number };
type RadarCandidateTile = RadarTileLayout & { pathname: string };
type RadarCandidateFrame = { entry: RadarTimeEntry; tiles: RadarCandidateTile[] };
type RadarCandidateResult = { complete: boolean; score: RadarFrameScore };

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

function frameKey(variant: string, validTime: string): string {
  return `${RADAR_FRAME_PREFIX}${variant}/${validTime}.webp`;
}

function radarTilePath(entry: RadarTimeEntry, zoom: number, tile: RadarTileLayout): string {
  return `/v1/radar/tile/jma/${entry.basetime}/${entry.validtime}/${zoom}/${tile.x}/${tile.y}.png`;
}

function visibleTileArea(tile: RadarTileLayout, width: number, height: number): RadarPixelArea | null {
  const left = Math.max(0, -tile.destX);
  const top = Math.max(0, -tile.destY);
  const right = Math.min(256, width - tile.destX);
  const bottom = Math.min(256, height - tile.destY);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(values.length, Math.max(1, Math.trunc(concurrency)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await operation(values[index]!, index);
    }
  }));
  return results;
}

async function scoreRadarTile(pathname: string, area: RadarPixelArea): Promise<RadarFrameScore | null> {
  const target = radarTileTargetForPath(pathname);
  if (!target) return null;
  try {
    const response = await fetch(target.upstream, {
      headers: { "User-Agent": "HomePanel-Cloud/2.6" },
      cf: { cacheEverything: true, cacheTtl: target.ttl },
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return emptyRadarFrameScore();
    }
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await scoreRadarPng(new Uint8Array(await response.arrayBuffer()), area);
  } catch (error) {
    console.warn("radar selection tile analysis failed", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function scoreRadarCandidates(
  candidates: readonly RadarCandidateFrame[],
  sourceWidth: number,
  sourceHeight: number,
): Promise<RadarCandidateResult[]> {
  const work: Array<{ frameIndex: number; tile: RadarCandidateTile; area: RadarPixelArea }> = [];
  for (let frameIndex = 0; frameIndex < candidates.length; frameIndex += 1) {
    for (const tile of candidates[frameIndex]!.tiles) {
      const area = visibleTileArea(tile, sourceWidth, sourceHeight);
      if (area) work.push({ frameIndex, tile, area });
    }
  }
  const tileScores = await mapWithConcurrency(work, RADAR_SCORE_FETCH_CONCURRENCY, item => (
    scoreRadarTile(item.tile.pathname, item.area)
  ));
  const byFrame: Array<Array<RadarFrameScore | null>> = Array.from(
    { length: candidates.length },
    () => [],
  );
  for (let index = 0; index < work.length; index += 1) {
    byFrame[work[index]!.frameIndex]!.push(tileScores[index] ?? null);
  }
  return byFrame.map((scores, index) => {
    const expected = candidates[index]!.tiles.length;
    if (scores.length !== expected || scores.some(score => score === null)) {
      return { complete: false, score: emptyRadarFrameScore() };
    }
    return {
      complete: true,
      score: mergeRadarFrameScores(scores as RadarFrameScore[]),
    };
  });
}

function bestCandidateIndex(results: readonly RadarCandidateResult[]): number {
  let best = 0;
  for (let index = 1; index < results.length; index += 1) {
    if (compareRadarFrameScores(results[index]!.score, results[best]!.score) > 0) best = index;
  }
  return best;
}

export async function radarFrameResponse(pathname: string, env: Env): Promise<Response> {
  const match = pathname.match(RADAR_FRAME_PATH);
  if (!match || !env.UPDATE_BUCKET) return new Response(null, { status: 404 });
  const object = await env.UPDATE_BUCKET.get(frameKey(match[1]!, match[2]!));
  if (!object?.body) return new Response(null, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "image/webp");
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
  const currentAt = jmaTimestampToMillis(entries[0]!.validtime);
  const width = RADAR_SOURCE_WIDTH;
  const height = RADAR_SOURCE_HEIGHT;
  const zoom = Math.trunc(envNumber(env.RADAR_ZOOM, DEFAULT_RADAR_ZOOM, 4, 14));
  const center = {
    lat: envNumber(env.RADAR_CENTER_LAT, DEFAULT_RADAR_CENTER.lat, -85.05112878, 85.05112878),
    lon: envNumber(env.RADAR_CENTER_LON, DEFAULT_RADAR_CENTER.lon, -180, 180),
  };

  // Rank every 5-minute frame using lower-zoom JMA tiles. At the default z10
  // display this reduces the scoring viewport from 192x128 to 48x32 pixels at
  // z8 and normally needs one tile per frame, keeping Worker CPU/subrequests
  // suitable for the free tier while preserving the same geographic extent.
  const selectionZoom = Math.min(zoom, RADAR_SELECTION_MAX_ZOOM);
  const selectionScale = 2 ** (zoom - selectionZoom);
  const selectionWidth = Math.max(1, Math.ceil(width / selectionScale));
  const selectionHeight = Math.max(1, Math.ceil(height / selectionScale));
  const selectionLayout = radarTileLayout(
    center.lat,
    center.lon,
    selectionZoom,
    selectionWidth,
    selectionHeight,
  );
  const candidates: RadarCandidateFrame[] = entries.map(entry => ({
    entry,
    tiles: selectionLayout.map(tile => ({
      ...tile,
      pathname: radarTilePath(entry, selectionZoom, tile),
    })),
  }));
  const candidateResults = await scoreRadarCandidates(candidates, selectionWidth, selectionHeight);
  const allComplete = candidateResults.length === candidates.length
      && candidateResults.every(result => result.complete);
  const selectedIndex = allComplete ? bestCandidateIndex(candidateResults) : 0;
  const selectedEntry = entries[selectedIndex]!;
  const selectedScore = candidateResults[selectedIndex]?.score ?? emptyRadarFrameScore();
  const noRainForecast = allComplete && selectedScore.rainSamples === 0;

  const displayLayout = radarTileLayout(center.lat, center.lon, zoom, width, height);
  const expires = Math.floor(Date.now() / 1000) + RADAR_TILE_URL_LIFETIME_SECONDS;
  const tiles = noRainForecast ? [] : await Promise.all(displayLayout.map(async tile => {
    const pathname = radarTilePath(selectedEntry, zoom, tile);
    return { ...tile, url: await signedRadarTilePath(env, pathname, expires) };
  }));
  const frame = {
    baseTime: selectedEntry.basetime,
    validTime: selectedEntry.validtime,
    validAt: jmaTimestampToMillis(selectedEntry.validtime),
    tiles,
  };
  const bundleUrl = tiles.length ? `/v1/radar/bundle/${selectedEntry.basetime}.hpb` : "";
  const payload = {
    provider: "JMA current-to-60-minute radar forecast; representative frame selected in cloud",
    precomposed: false,
    bundleUrl,
    width,
    height,
    outputWidth: RADAR_OUTPUT_WIDTH,
    outputHeight: RADAR_OUTPUT_HEIGHT,
    center,
    zoom,
    forecastWindowMs: RADAR_FORECAST_WINDOW_MS,
    frameIntervalMs: RADAR_FRAME_INTERVAL_MS,
    noRainForecast,
    selection: {
      strategy: allComplete ? "weighted-coverage-intensity-v1" : "fallback-current-v1",
      scoringZoom: selectionZoom,
      candidateCount: entries.length,
      rainSamples: selectedScore.rainSamples,
      intensityPoints: selectedScore.intensityPoints,
      maxIntensityRank: selectedScore.maxIntensityRank,
      score: selectedScore.score,
    },
    frames: [frame],
    legend: RADAR_LEGEND,
  };
  if (tiles.length) await prewarmRadarBundle(env, payload, entries[0]!.basetime);
  return {
    source: "radar",
    payload,
    observedAt: currentAt,
  };
}
