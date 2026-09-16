import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "./sources";

export interface BrowserRadarTile {
  url: string;
  destX: number;
  destY: number;
}

export interface BrowserRadarPanelRequest {
  tiles: BrowserRadarTile[];
  sourceWidth: number;
  sourceHeight: number;
  baseCropWidth: number;
  baseCropHeight: number;
  worldLeft: number;
  worldTop: number;
  zoom: number;
  validTimeText: string;
}

export interface BrowserRadarLocation {
  lat: number;
  lon: number;
}

export interface BrowserRadarRenderRequest {
  publicUrl: string;
  outputWidth: number;
  outputHeight: number;
  location: BrowserRadarLocation;
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
      validTimeText: panel.validTimeText,
      tiles: panel.tiles,
      sourceWidth: panel.sourceWidth,
      sourceHeight: panel.sourceHeight,
      baseCropWidth: panel.baseCropWidth,
      baseCropHeight: panel.baseCropHeight,
      worldLeft: panel.worldLeft,
      worldTop: panel.worldTop,
      zoom: panel.zoom,
    }));

    await page.evaluate(async (payload) => {
      const g = globalThis as unknown as {
        document: {
          getElementById(id: string): any;
        };
        createImageBitmap(blob: Blob): Promise<any>;
      };
      const canvas = g.document.getElementById("radar-frame");
      if (!canvas) throw new Error("radar render canvas unavailable");
      canvas.width = payload.outputWidth;
      canvas.height = payload.outputHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("radar render context unavailable");

      const logicalPanelWidth = payload.panels[0]?.sourceWidth ?? 0;
      const logicalOutputHeight = payload.panels[0]?.sourceHeight ?? 0;
      const logicalOutputWidth = logicalPanelWidth * payload.panels.length;
      if (logicalPanelWidth <= 0 || logicalOutputHeight <= 0 || logicalOutputWidth <= 0) {
        throw new Error("radar logical render size is invalid");
      }
      for (const panel of payload.panels) {
        if (panel.sourceWidth !== logicalPanelWidth
            || panel.sourceHeight !== logicalOutputHeight
            || panel.baseCropWidth !== logicalPanelWidth
            || panel.baseCropHeight !== logicalOutputHeight) {
          throw new Error("radar panel source/crop must match logical render pixels");
        }
      }
      context.scale(
        payload.outputWidth / logicalOutputWidth,
        payload.outputHeight / logicalOutputHeight,
      );
      const panelWidth = logicalPanelWidth;

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

      const drawBase = (bitmap: any, panel: any, panelX: number) => {
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
          logicalOutputHeight,
        );
      };

      const worldPixel = (lon: number, lat: number, zoom: number) => {
        const scale = 2 ** zoom * 256;
        const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
        const radians = safeLat * Math.PI / 180;
        return {
          x: (lon + 180) / 360 * scale,
          y: (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale,
        };
      };

      const drawLocationMarker = (panel: any, panelX: number) => {
        const lat = Number(payload.location.lat);
        const lon = Number(payload.location.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)
            || !Number.isFinite(panel.worldLeft)
            || !Number.isFinite(panel.worldTop)
            || !Number.isFinite(panel.zoom)) {
          throw new Error("radar location marker coordinates are invalid");
        }
        const scaleX = panelWidth / panel.sourceWidth;
        const scaleY = logicalOutputHeight / panel.sourceHeight;
        const world = worldPixel(lon, lat, panel.zoom);
        const x = panelX + (world.x - panel.worldLeft) * scaleX;
        const y = (world.y - panel.worldTop) * scaleY;
        const fullCircle = Math.PI * 2;

        context.save();
        context.beginPath();
        context.arc(x, y, 24, 0, fullCircle);
        context.fillStyle = "rgba(66,133,244,0.20)";
        context.fill();

        context.beginPath();
        context.arc(x, y, 13, 0, fullCircle);
        context.fillStyle = "rgba(255,255,255,0.98)";
        context.fill();

        context.beginPath();
        context.arc(x, y, 9, 0, fullCircle);
        context.fillStyle = "#4285F4";
        context.fill();
        context.restore();
      };

      const drawPanelLabel = (panel: any, panelX: number) => {
        const timeText = panel.validTimeText as string;
        const chipLeft = 18;
        const chipTop = 70;
        const chipHorizontalPadding = 20;
        const chipHeight = 84;
        context.font = "500 39px sans-serif";
        context.textBaseline = "middle";
        const timeWidth = context.measureText(timeText).width;
        const chipWidth = Math.min(
          panelWidth - chipLeft * 2,
          timeWidth + chipHorizontalPadding * 2,
        );
        context.fillStyle = "rgba(0,0,0,0.78)";
        context.beginPath();
        context.roundRect(panelX + chipLeft, chipTop, chipWidth, chipHeight, 17);
        context.fill();
        context.fillStyle = "white";
        context.fillText(
          timeText,
          panelX + chipLeft + chipHorizontalPadding,
          chipTop + chipHeight / 2,
        );
      };

      for (let panelIndex = 0; panelIndex < payload.panels.length; panelIndex += 1) {
        const panel = payload.panels[panelIndex]!;
        const panelX = panelIndex * panelWidth;
        context.save();
        context.beginPath();
        context.rect(panelX, 0, panelWidth, logicalOutputHeight);
        context.clip();

        drawBase(satellite, panel, panelX);
        const scaleX = panelWidth / panel.sourceWidth;
        const scaleY = logicalOutputHeight / panel.sourceHeight;

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
        drawLocationMarker(panel, panelX);
        context.restore();
      }

      satellite.close?.();

      context.fillStyle = "rgba(0,0,0,0.92)";
      for (let divider = 1; divider < payload.panels.length; divider += 1) {
        context.fillRect(divider * panelWidth - 1, 0, 3, logicalOutputHeight);
      }

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
      location: request.location,
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
