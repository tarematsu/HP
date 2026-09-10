import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "./sources";

export interface BrowserRadarTile {
  url: string;
  destX: number;
  destY: number;
}

export interface BrowserRadarPanelRequest {
  title: string;
  tiles: BrowserRadarTile[];
  sourceWidth: number;
  sourceHeight: number;
  baseCropWidth: number;
  baseCropHeight: number;
  validTimeText: string;
}

export interface BrowserRadarRenderRequest {
  publicUrl: string;
  outputWidth: number;
  outputHeight: number;
  panels: [
    BrowserRadarPanelRequest,
    BrowserRadarPanelRequest,
    BrowserRadarPanelRequest,
  ];
}

export interface BrowserRadarPanelResult {
  validTimeText: string;
}

export interface BrowserRadarRenderResult {
  png: Uint8Array;
  panels: [
    BrowserRadarPanelResult,
    BrowserRadarPanelResult,
    BrowserRadarPanelResult,
  ];
}

type BrowserBindingEnv = Env & { BROWSER?: Fetcher };

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

    const panelResults = request.panels.map(panel => ({
      title: panel.title,
      validTimeText: panel.validTimeText,
      tiles: panel.tiles,
      sourceWidth: panel.sourceWidth,
      sourceHeight: panel.sourceHeight,
      baseCropWidth: panel.baseCropWidth,
      baseCropHeight: panel.baseCropHeight,
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
      const panelWidth = Math.floor(payload.outputWidth / payload.panels.length);

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
      if (satellite.width !== map.width || satellite.height !== map.height) {
        throw new Error(
          `radar static layer dimensions differ: satellite=${satellite.width}x${satellite.height}, map=${map.width}x${map.height}`,
        );
      }

      const drawBase = (bitmap: any, panel: any, panelX: number) => {
        // Satellite and the pre-generated Kawagoe gray-mask map are both z10
        // layers centered on the same coordinate. Crop the exact z10 pixel
        // extent corresponding to the z9 rain source instead of inferring the
        // crop from image aspect ratio.
        const cropWidth = panel.baseCropWidth as number;
        const cropHeight = panel.baseCropHeight as number;
        if (bitmap.width < cropWidth || bitmap.height < cropHeight) {
          throw new Error(
            `radar static layer is smaller than required crop: ${bitmap.width}x${bitmap.height} < ${cropWidth}x${cropHeight}`,
          );
        }
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

      const drawPanelLabel = (panel: any, panelX: number) => {
        const title = panel.title as string;
        const timeText = panel.validTimeText as string;
        const chipLeft = 24;
        const chipTop = 72;
        const chipHorizontalPadding = 27;
        const chipHeight = 112;
        context.font = "600 42px sans-serif";
        context.textBaseline = "middle";
        const titleWidth = context.measureText(title).width;
        context.font = "500 34px sans-serif";
        const timeWidth = context.measureText(timeText).width;
        const chipWidth = Math.min(
          panelWidth - chipLeft * 2,
          Math.max(titleWidth, timeWidth) + chipHorizontalPadding * 2,
        );
        context.fillStyle = "rgba(0,0,0,0.78)";
        context.beginPath();
        context.roundRect(panelX + chipLeft, chipTop, chipWidth, chipHeight, 22);
        context.fill();
        context.fillStyle = "white";
        context.font = "600 42px sans-serif";
        context.fillText(title, panelX + chipLeft + chipHorizontalPadding, chipTop + 33);
        context.font = "500 34px sans-serif";
        context.fillText(timeText, panelX + chipLeft + chipHorizontalPadding, chipTop + 81);
      };

      for (let panelIndex = 0; panelIndex < payload.panels.length; panelIndex += 1) {
        const panel = payload.panels[panelIndex]!;
        const panelX = panelIndex * panelWidth;

        // Fixed compositing order: satellite -> rain -> pre-generated gray map.
        drawBase(satellite, panel, panelX);
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
        drawBase(map, panel, panelX);
      }

      satellite.close?.();
      map.close?.();

      context.fillStyle = "rgba(0,0,0,0.92)";
      for (let divider = 1; divider < payload.panels.length; divider += 1) {
        context.fillRect(divider * panelWidth - 2, 0, 4, payload.outputHeight);
      }

      // Labels are a final pass so no rain/map tile can ever cover the time.
      for (let panelIndex = 0; panelIndex < payload.panels.length; panelIndex += 1) {
        const panel = payload.panels[panelIndex]!;
        const panelX = panelIndex * panelWidth;
        drawPanelLabel(panel, panelX);
      }
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
      panels: panelResults.map(panel => ({ validTimeText: panel.validTimeText })) as [
        BrowserRadarPanelResult,
        BrowserRadarPanelResult,
        BrowserRadarPanelResult,
      ],
    };
  } finally {
    await browser.close();
  }
}
