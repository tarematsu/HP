import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "./sources";

export interface BrowserRadarTile {
  url: string;
  destX: number;
  destY: number;
}

export interface BrowserRadarCandidate {
  index: number;
  tiles: BrowserRadarTile[];
}

export interface BrowserRadarRenderRequest {
  publicUrl: string;
  candidates: BrowserRadarCandidate[];
  forcedIndex?: number;
  displayTiles: (selectedIndex: number) => Promise<BrowserRadarTile[]>;
  selectionWidth: number;
  selectionHeight: number;
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface BrowserRadarRenderResult {
  png: Uint8Array;
  selectedIndex: number;
  rainSamples: number;
  intensityPoints: number;
  maxIntensityRank: number;
  score: number;
}

type BrowserBindingEnv = Env & { BROWSER?: Fetcher };

const PRECIPITATION_COLORS = [
  [242, 242, 255, 1],
  [160, 210, 255, 2],
  [33, 140, 255, 3],
  [0, 65, 255, 5],
  [250, 245, 0, 8],
  [255, 153, 0, 12],
  [255, 40, 0, 18],
  [180, 0, 104, 24],
] as const;
const COVERAGE_WEIGHT = 32;
const RENDER_PAGE_PATH = "/radar-cloud/render.html";
const SATELLITE_ASSET_PATH = "/radar-cloud/radar-satellite.png";
const MAP_ASSET_PATH = "/radar-cloud/radar-map.png";

function originUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

export async function renderRepresentativeRadarFrame(
  env: Env,
  request: BrowserRadarRenderRequest,
): Promise<BrowserRadarRenderResult> {
  const browserBinding = (env as BrowserBindingEnv).BROWSER;
  if (!browserBinding) throw new Error("Cloudflare Browser Run binding is unavailable");
  const publicOrigin = originUrl(request.publicUrl);
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(8_000);
    await page.setViewport({
      width: request.outputWidth,
      height: request.outputHeight,
      deviceScaleFactor: 1,
    });
    await page.goto(`${publicOrigin}${RENDER_PAGE_PATH}`, {
      waitUntil: "domcontentloaded",
      timeout: 8_000,
    });

    let selected = {
      index: request.forcedIndex ?? request.candidates[0]?.index ?? 0,
      rainSamples: 0,
      intensityPoints: 0,
      maxIntensityRank: 0,
      score: 0,
    };
    if (request.forcedIndex === undefined && request.candidates.length > 0) {
      selected = await page.evaluate(async (payload) => {
        const g = globalThis as unknown as {
          document: { createElement(tag: string): any };
          createImageBitmap(blob: Blob): Promise<any>;
        };
        const canvas = g.document.createElement("canvas");
        canvas.width = payload.width;
        canvas.height = payload.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("radar scoring canvas unavailable");
        const colors = payload.colors as number[][];

        const loadTile = async (url: string) => {
          const response = await fetch(url, { cache: "force-cache" });
          if (response.status === 404) return null;
          if (!response.ok) throw new Error(`radar scoring tile HTTP ${response.status}`);
          return g.createImageBitmap(await response.blob());
        };
        const scoreCurrent = () => {
          const pixels = context.getImageData(0, 0, payload.width, payload.height).data as Uint8ClampedArray;
          let rainSamples = 0;
          let intensityPoints = 0;
          let maxIntensityRank = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            const alpha = pixels[offset + 3] ?? 0;
            if (alpha === 0) continue;
            const red = pixels[offset] ?? 0;
            const green = pixels[offset + 1] ?? 0;
            const blue = pixels[offset + 2] ?? 0;
            let best = 0;
            let bestDistance = Number.POSITIVE_INFINITY;
            for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
              const color = colors[colorIndex]!;
              const dr = red - color[0]!;
              const dg = green - color[1]!;
              const db = blue - color[2]!;
              const distance = dr * dr + dg * dg + db * db;
              if (distance < bestDistance) {
                bestDistance = distance;
                best = colorIndex;
              }
            }
            rainSamples += 1;
            intensityPoints += colors[best]?.[3] ?? 1;
            maxIntensityRank = Math.max(maxIntensityRank, best + 1);
          }
          return {
            rainSamples,
            intensityPoints,
            maxIntensityRank,
            score: rainSamples * payload.coverageWeight + intensityPoints,
          };
        };

        let best = {
          index: payload.candidates[0]?.index ?? 0,
          rainSamples: 0,
          intensityPoints: 0,
          maxIntensityRank: 0,
          score: -1,
        };
        for (const candidate of payload.candidates as Array<{ index: number; tiles: Array<{ url: string; destX: number; destY: number }> }>) {
          context.clearRect(0, 0, payload.width, payload.height);
          for (const tile of candidate.tiles) {
            const bitmap = await loadTile(tile.url);
            if (!bitmap) continue;
            context.drawImage(bitmap, tile.destX, tile.destY, 256, 256);
            bitmap.close?.();
          }
          const score = scoreCurrent();
          const better = score.score > best.score
            || (score.score === best.score && score.rainSamples > best.rainSamples)
            || (score.score === best.score && score.rainSamples === best.rainSamples
              && score.intensityPoints > best.intensityPoints)
            || (score.score === best.score && score.rainSamples === best.rainSamples
              && score.intensityPoints === best.intensityPoints
              && score.maxIntensityRank > best.maxIntensityRank);
          if (better) best = { index: candidate.index, ...score };
        }
        return best;
      }, {
        width: request.selectionWidth,
        height: request.selectionHeight,
        candidates: request.candidates,
        colors: PRECIPITATION_COLORS,
        coverageWeight: COVERAGE_WEIGHT,
      });
    }

    const displayTiles = await request.displayTiles(selected.index);
    await page.evaluate(async (payload) => {
      const g = globalThis as unknown as {
        document: { getElementById(id: string): any };
        createImageBitmap(blob: Blob): Promise<any>;
      };
      const canvas = g.document.getElementById("radar-frame");
      if (!canvas) throw new Error("radar render canvas unavailable");
      canvas.width = payload.outputWidth;
      canvas.height = payload.outputHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("radar render context unavailable");

      const loadRequired = async (url: string) => {
        const response = await fetch(url, { cache: "force-cache" });
        if (!response.ok) throw new Error(`radar base image HTTP ${response.status}`);
        return g.createImageBitmap(await response.blob());
      };
      const loadRain = async (url: string) => {
        const response = await fetch(url, { cache: "force-cache" });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`radar display tile HTTP ${response.status}`);
        return g.createImageBitmap(await response.blob());
      };
      const drawCenteredFortyPercent = (bitmap: any) => {
        const cropWidth = Math.max(1, Math.floor(bitmap.width * 0.4));
        const cropHeight = Math.max(1, Math.floor(bitmap.height * 0.4));
        const sourceX = Math.floor((bitmap.width - cropWidth) / 2);
        const sourceY = Math.floor((bitmap.height - cropHeight) / 2);
        context.drawImage(
          bitmap,
          sourceX,
          sourceY,
          cropWidth,
          cropHeight,
          0,
          0,
          payload.outputWidth,
          payload.outputHeight,
        );
      };

      const satellite = await loadRequired(payload.satelliteUrl);
      drawCenteredFortyPercent(satellite);
      satellite.close?.();

      const scaleX = payload.outputWidth / payload.sourceWidth;
      const scaleY = payload.outputHeight / payload.sourceHeight;
      for (const tile of payload.tiles as Array<{ url: string; destX: number; destY: number }>) {
        const bitmap = await loadRain(tile.url);
        if (!bitmap) continue;
        context.drawImage(
          bitmap,
          Math.round(tile.destX * scaleX),
          Math.round(tile.destY * scaleY),
          Math.ceil(256 * scaleX),
          Math.ceil(256 * scaleY),
        );
        bitmap.close?.();
      }

      const map = await loadRequired(payload.mapUrl);
      drawCenteredFortyPercent(map);
      map.close?.();
    }, {
      outputWidth: request.outputWidth,
      outputHeight: request.outputHeight,
      sourceWidth: request.sourceWidth,
      sourceHeight: request.sourceHeight,
      tiles: displayTiles,
      satelliteUrl: `${publicOrigin}${SATELLITE_ASSET_PATH}`,
      mapUrl: `${publicOrigin}${MAP_ASSET_PATH}`,
    });

    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: request.outputWidth, height: request.outputHeight },
      captureBeyondViewport: false,
    });
    return {
      png: new Uint8Array(screenshot),
      selectedIndex: selected.index,
      rainSamples: selected.rainSamples,
      intensityPoints: selected.intensityPoints,
      maxIntensityRank: selected.maxIntensityRank,
      score: selected.score,
    };
  } finally {
    await browser.close();
  }
}
