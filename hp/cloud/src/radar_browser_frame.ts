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

export interface BrowserRadarPanelRequest {
  title: string;
  candidates: BrowserRadarCandidate[];
  forcedIndex?: number;
  displayTiles: (selectedIndex: number) => Promise<BrowserRadarTile[]>;
  selectionWidth: number;
  selectionHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  validTimeText: (selectedIndex: number) => string;
}

export interface BrowserRadarRenderRequest {
  publicUrl: string;
  outputWidth: number;
  outputHeight: number;
  panels: [BrowserRadarPanelRequest, BrowserRadarPanelRequest];
}

export interface BrowserRadarPanelResult {
  selectedIndex: number;
  rainSamples: number;
  intensityPoints: number;
  maxIntensityRank: number;
  score: number;
  validTimeText: string;
}

export interface BrowserRadarRenderResult {
  png: Uint8Array;
  panels: [BrowserRadarPanelResult, BrowserRadarPanelResult];
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

    const scored = await page.evaluate(async (payload) => {
      const g = globalThis as unknown as {
        document: { createElement(tag: string): any };
        createImageBitmap(blob: Blob): Promise<any>;
      };
      const colors = payload.colors as number[][];
      const scorePanel = async (panel: {
        width: number;
        height: number;
        forcedIndex?: number;
        candidates: Array<{ index: number; tiles: Array<{ url: string; destX: number; destY: number }> }>;
      }) => {
        if (panel.forcedIndex !== undefined) {
          return {
            selectedIndex: panel.forcedIndex,
            rainSamples: 0,
            intensityPoints: 0,
            maxIntensityRank: 0,
            score: 0,
          };
        }
        if (!panel.candidates.length) {
          return {
            selectedIndex: 0,
            rainSamples: 0,
            intensityPoints: 0,
            maxIntensityRank: 0,
            score: 0,
          };
        }
        const canvas = g.document.createElement("canvas");
        canvas.width = panel.width;
        canvas.height = panel.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("radar scoring canvas unavailable");
        const loadTile = async (url: string) => {
          const response = await fetch(url, { cache: "force-cache" });
          if (response.status === 404) return null;
          if (!response.ok) throw new Error(`radar scoring tile HTTP ${response.status}`);
          return g.createImageBitmap(await response.blob());
        };
        let best = {
          selectedIndex: panel.candidates[0]?.index ?? 0,
          rainSamples: 0,
          intensityPoints: 0,
          maxIntensityRank: 0,
          score: -1,
        };
        for (const candidate of panel.candidates) {
          context.clearRect(0, 0, panel.width, panel.height);
          for (const tile of candidate.tiles) {
            const bitmap = await loadTile(tile.url);
            if (!bitmap) continue;
            context.drawImage(bitmap, tile.destX, tile.destY, 256, 256);
            bitmap.close?.();
          }
          const pixels = context.getImageData(0, 0, panel.width, panel.height).data as Uint8ClampedArray;
          let rainSamples = 0;
          let intensityPoints = 0;
          let maxIntensityRank = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if ((pixels[offset + 3] ?? 0) === 0) continue;
            const red = pixels[offset] ?? 0;
            const green = pixels[offset + 1] ?? 0;
            const blue = pixels[offset + 2] ?? 0;
            let bestColor = 0;
            let bestDistance = Number.POSITIVE_INFINITY;
            for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
              const color = colors[colorIndex]!;
              const dr = red - color[0]!;
              const dg = green - color[1]!;
              const db = blue - color[2]!;
              const distance = dr * dr + dg * dg + db * db;
              if (distance < bestDistance) {
                bestDistance = distance;
                bestColor = colorIndex;
              }
            }
            rainSamples += 1;
            intensityPoints += colors[bestColor]?.[3] ?? 1;
            maxIntensityRank = Math.max(maxIntensityRank, bestColor + 1);
          }
          const score = rainSamples * payload.coverageWeight + intensityPoints;
          const better = score > best.score
            || (score === best.score && rainSamples > best.rainSamples)
            || (score === best.score && rainSamples === best.rainSamples
              && intensityPoints > best.intensityPoints)
            || (score === best.score && rainSamples === best.rainSamples
              && intensityPoints === best.intensityPoints
              && maxIntensityRank > best.maxIntensityRank);
          if (better) {
            best = {
              selectedIndex: candidate.index,
              rainSamples,
              intensityPoints,
              maxIntensityRank,
              score,
            };
          }
        }
        return best;
      };
      const results = [];
      for (const panel of payload.panels) results.push(await scorePanel(panel));
      return results;
    }, {
      panels: request.panels.map(panel => ({
        width: panel.selectionWidth,
        height: panel.selectionHeight,
        candidates: panel.candidates,
        ...(panel.forcedIndex === undefined ? {} : { forcedIndex: panel.forcedIndex }),
      })),
      colors: PRECIPITATION_COLORS,
      coverageWeight: COVERAGE_WEIGHT,
    });

    const panelResults = await Promise.all(request.panels.map(async (panel, index) => {
      const raw = scored[index]!;
      const selectedIndex = raw.selectedIndex;
      return {
        selectedIndex,
        rainSamples: raw.rainSamples,
        intensityPoints: raw.intensityPoints,
        maxIntensityRank: raw.maxIntensityRank,
        score: raw.score,
        validTimeText: panel.validTimeText(selectedIndex),
        tiles: await panel.displayTiles(selectedIndex),
        title: panel.title,
        sourceWidth: panel.sourceWidth,
        sourceHeight: panel.sourceHeight,
      };
    }));

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
      const panelWidth = Math.floor(payload.outputWidth / 2);

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
      const satellite = await loadRequired(payload.satelliteUrl);
      const map = await loadRequired(payload.mapUrl);
      const drawBase = (bitmap: any, panelX: number) => {
        const cropWidth = Math.max(1, Math.floor(bitmap.width * 0.2));
        const cropHeight = Math.max(1, Math.floor(bitmap.height * 0.4));
        const sourceX = Math.floor((bitmap.width - cropWidth) / 2);
        const sourceY = Math.floor((bitmap.height - cropHeight) / 2);
        context.drawImage(
          bitmap,
          sourceX,
          sourceY,
          cropWidth,
          cropHeight,
          panelX,
          0,
          panelWidth,
          payload.outputHeight,
        );
      };

      for (let panelIndex = 0; panelIndex < payload.panels.length; panelIndex += 1) {
        const panel = payload.panels[panelIndex]!;
        const panelX = panelIndex * panelWidth;
        drawBase(satellite, panelX);
        const scaleX = panelWidth / panel.sourceWidth;
        const scaleY = payload.outputHeight / panel.sourceHeight;
        for (const tile of panel.tiles as Array<{ url: string; destX: number; destY: number }>) {
          const bitmap = await loadRain(tile.url);
          if (!bitmap) continue;
          context.drawImage(
            bitmap,
            panelX + Math.round(tile.destX * scaleX),
            Math.round(tile.destY * scaleY),
            Math.ceil(256 * scaleX),
            Math.ceil(256 * scaleY),
          );
          bitmap.close?.();
        }
        drawBase(map, panelX);

        const title = panel.title as string;
        const timeText = panel.validTimeText as string;
        context.font = "600 42px sans-serif";
        context.textBaseline = "middle";
        const titleWidth = context.measureText(title).width;
        context.font = "500 34px sans-serif";
        const timeWidth = context.measureText(timeText).width;
        const chipWidth = Math.max(titleWidth, timeWidth) + 54;
        const chipHeight = 112;
        context.fillStyle = "rgba(0,0,0,0.62)";
        context.beginPath();
        context.roundRect(panelX + 24, 24, chipWidth, chipHeight, 22);
        context.fill();
        context.fillStyle = "white";
        context.font = "600 42px sans-serif";
        context.fillText(title, panelX + 50, 57);
        context.font = "500 34px sans-serif";
        context.fillText(timeText, panelX + 50, 105);
      }
      satellite.close?.();
      map.close?.();
      context.fillStyle = "rgba(255,255,255,0.58)";
      context.fillRect(panelWidth - 1, 0, 2, payload.outputHeight);
    }, {
      outputWidth: request.outputWidth,
      outputHeight: request.outputHeight,
      panels: panelResults,
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
      panels: panelResults.map(({ tiles: _tiles, title: _title, sourceWidth: _sourceWidth, sourceHeight: _sourceHeight, ...result }) => result) as [BrowserRadarPanelResult, BrowserRadarPanelResult],
    };
  } finally {
    await browser.close();
  }
}
