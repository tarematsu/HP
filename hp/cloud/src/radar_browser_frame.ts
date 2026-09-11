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
  worldLeft: number;
  worldTop: number;
  zoom: number;
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
const SUNNY_ICON_ASSET_PATH = "/radar-cloud/weather-sunny.png";
const KAWAGOE_BOUNDARY_URL = "https://geoshape.ex.nii.ac.jp/city/geojson/latest/11201.geojson";
export const KAWAGOE_MASK_PATH = "/v1/radar/frame/mask/kawagoe-v1.png";
export const KAWAGOE_MASK_KEY = "radar/assets/kawagoe-mask-v1-480x960.png";
const RAIN_ANALYSIS_WIDTH = 80;
const RAIN_ANALYSIS_HEIGHT = 160;

function originUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

async function fetchKawagoeBoundary(): Promise<unknown | null> {
  try {
    const response = await fetch(KAWAGOE_BOUNDARY_URL, {
      headers: { "User-Agent": "HomePanel-Cloud/2.6" },
      cf: { cacheEverything: true, cacheTtl: 86_400 },
    } as RequestInit);
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function decodePngDataUrl(value: string): Uint8Array {
  const marker = ";base64,";
  const markerAt = value.indexOf(marker);
  if (!value.startsWith("data:image/png") || markerAt < 0) {
    throw new Error("invalid Kawagoe mask data URL");
  }
  const binary = atob(value.slice(markerAt + marker.length));
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

export async function renderRepresentativeRadarFrame(
  env: Env,
  request: BrowserRadarRenderRequest,
): Promise<BrowserRadarRenderResult> {
  const browserBinding = (env as BrowserBindingEnv).BROWSER;
  if (!browserBinding) throw new Error("Cloudflare Browser Run binding is unavailable");
  const publicOrigin = originUrl(request.publicUrl);
  const storedMask = env.UPDATE_BUCKET
    ? await env.UPDATE_BUCKET.head(KAWAGOE_MASK_KEY)
    : null;
  const boundary = storedMask ? null : await fetchKawagoeBoundary();
  if (!storedMask && !boundary) {
    throw new Error("Kawagoe boundary is unavailable for static radar mask warmup");
  }

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
      worldLeft: panel.worldLeft,
      worldTop: panel.worldTop,
      zoom: panel.zoom,
    }));

    const evaluation = await page.evaluate(async (payload) => {
      const g = globalThis as unknown as {
        document: {
          getElementById(id: string): any;
          createElement(tagName: string): any;
        };
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
      let sunnyIcon: any | null = null;
      const getSunnyIcon = async () => {
        if (!sunnyIcon) sunnyIcon = await loadRequired(payload.sunnyIconUrl);
        return sunnyIcon;
      };

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
          payload.outputHeight,
        );
      };

      const boundary = payload.boundary as any;
      const boundaryGeometries: any[] = (() => {
        if (!boundary || typeof boundary !== "object") return [];
        if (boundary.type === "FeatureCollection") {
          return Array.isArray(boundary.features)
            ? boundary.features.map((feature: any) => feature?.geometry).filter(Boolean)
            : [];
        }
        if (boundary.type === "Feature") return boundary.geometry ? [boundary.geometry] : [];
        return [boundary];
      })();
      const boundaryPolygons: any[] = boundaryGeometries.flatMap((geometry: any) => (
        geometry?.type === "Polygon"
          ? [geometry.coordinates]
          : geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)
            ? geometry.coordinates
            : []
      ));

      const worldPixel = (lon: number, lat: number, zoom: number) => {
        const scale = 2 ** zoom * 256;
        const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
        const radians = safeLat * Math.PI / 180;
        return {
          x: (lon + 180) / 360 * scale,
          y: (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale,
        };
      };
      const addBoundaryPath = (target: any, panel: any) => {
        if (!boundaryPolygons.length) return false;
        if (!Number.isFinite(panel.worldLeft)
            || !Number.isFinite(panel.worldTop)
            || !Number.isFinite(panel.zoom)) return false;
        const scaleX = panelWidth / panel.sourceWidth;
        const scaleY = payload.outputHeight / panel.sourceHeight;
        let drewPoint = false;
        for (const polygon of boundaryPolygons) {
          if (!Array.isArray(polygon)) continue;
          for (const ring of polygon) {
            if (!Array.isArray(ring) || ring.length < 2) continue;
            let first = true;
            for (const coordinate of ring) {
              if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
              const lon = Number(coordinate[0]);
              const lat = Number(coordinate[1]);
              if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
              const world = worldPixel(lon, lat, panel.zoom);
              const x = (world.x - panel.worldLeft) * scaleX;
              const y = (world.y - panel.worldTop) * scaleY;
              if (first) {
                target.moveTo(x, y);
                first = false;
              } else {
                target.lineTo(x, y);
              }
              drewPoint = true;
            }
            if (!first) target.closePath();
          }
        }
        return drewPoint;
      };

      let generatedMaskDataUrl: string | null = null;
      let kawagoeMask: any | null = payload.kawagoeMaskUrl
        ? await loadRequired(payload.kawagoeMaskUrl)
        : null;
      if (!kawagoeMask && boundaryPolygons.length) {
        const maskCanvas = g.document.createElement("canvas");
        maskCanvas.width = panelWidth;
        maskCanvas.height = payload.outputHeight;
        const maskContext = maskCanvas.getContext("2d");
        if (!maskContext) throw new Error("radar Kawagoe mask canvas unavailable");

        maskContext.beginPath();
        maskContext.rect(0, 0, panelWidth, payload.outputHeight);
        if (!addBoundaryPath(maskContext, payload.panels[0])) {
          throw new Error("radar Kawagoe boundary could not be projected");
        }
        maskContext.fillStyle = "rgba(96,96,96,0.68)";
        maskContext.fill("evenodd");

        maskContext.beginPath();
        if (!addBoundaryPath(maskContext, payload.panels[0])) {
          throw new Error("radar Kawagoe boundary could not be stroked");
        }
        maskContext.strokeStyle = "rgba(255,255,255,0.98)";
        maskContext.lineWidth = 4;
        maskContext.lineJoin = "round";
        maskContext.lineCap = "round";
        maskContext.stroke();
        kawagoeMask = maskCanvas;
        generatedMaskDataUrl = maskCanvas.toDataURL("image/png");
      }
      if (!kawagoeMask) throw new Error("radar Kawagoe mask unavailable");

      const drawNoRainPanel = async (panelX: number) => {
        context.save();
        context.fillStyle = "rgba(96,96,96,0.72)";
        context.fillRect(panelX, 0, panelWidth, payload.outputHeight);
        context.restore();
        const icon = await getSunnyIcon();
        const iconSize = Math.round(Math.min(panelWidth * 0.56, payload.outputHeight * 0.30));
        const iconX = panelX + Math.round((panelWidth - iconSize) / 2);
        const iconY = Math.round((payload.outputHeight - iconSize) / 2);
        context.drawImage(icon, iconX, iconY, iconSize, iconSize);
      };

      const drawPanelLabel = (panel: any, panelX: number) => {
        const title = panel.title as string;
        const timeText = panel.validTimeText as string;
        const chipLeft = 18;
        const chipTop = 180;
        const chipHorizontalPadding = 20;
        const chipHeight = 84;
        context.font = "600 32px sans-serif";
        context.textBaseline = "middle";
        const titleWidth = context.measureText(title).width;
        context.font = "500 26px sans-serif";
        const timeWidth = context.measureText(timeText).width;
        const chipWidth = Math.min(
          panelWidth - chipLeft * 2,
          Math.max(titleWidth, timeWidth) + chipHorizontalPadding * 2,
        );
        context.fillStyle = "rgba(0,0,0,0.78)";
        context.beginPath();
        context.roundRect(panelX + chipLeft, chipTop, chipWidth, chipHeight, 17);
        context.fill();
        context.fillStyle = "white";
        context.font = "600 32px sans-serif";
        context.fillText(title, panelX + chipLeft + chipHorizontalPadding, chipTop + 25);
        context.font = "500 26px sans-serif";
        context.fillText(timeText, panelX + chipLeft + chipHorizontalPadding, chipTop + 61);
      };

      for (let panelIndex = 0; panelIndex < payload.panels.length; panelIndex += 1) {
        const panel = payload.panels[panelIndex]!;
        const panelX = panelIndex * panelWidth;
        drawBase(satellite, panel, panelX);
        const scaleX = panelWidth / panel.sourceWidth;
        const scaleY = payload.outputHeight / panel.sourceHeight;
        const rainCanvas = g.document.createElement("canvas");
        rainCanvas.width = payload.analysisWidth;
        rainCanvas.height = payload.analysisHeight;
        const rainContext = rainCanvas.getContext("2d");
        if (!rainContext) throw new Error("radar rain analysis canvas unavailable");
        rainContext.imageSmoothingEnabled = false;
        rainContext.clearRect(0, 0, payload.analysisWidth, payload.analysisHeight);
        const analysisScaleX = payload.analysisWidth / panel.sourceWidth;
        const analysisScaleY = payload.analysisHeight / panel.sourceHeight;

        const rainLayers: Array<{
          bitmap: any;
          tile: { url: string; destX: number; destY: number };
        }> = [];
        for (const tile of panel.tiles as Array<{ url: string; destX: number; destY: number }>) {
          const bitmap = await loadRain(tile.url);
          if (!bitmap) continue;
          rainContext.drawImage(
            bitmap,
            Math.round(tile.destX * analysisScaleX),
            Math.round(tile.destY * analysisScaleY),
            Math.ceil(256 * analysisScaleX),
            Math.ceil(256 * analysisScaleY),
          );
          rainLayers.push({ bitmap, tile });
        }

        const rainPixels = rainContext.getImageData(
          0, 0, payload.analysisWidth, payload.analysisHeight,
        ).data;
        let hasRain = false;
        for (let offset = 3; offset < rainPixels.length; offset += 4) {
          if (rainPixels[offset] > 8) {
            hasRain = true;
            break;
          }
        }

        if (!hasRain) {
          await drawNoRainPanel(panelX);
        } else {
          for (const { bitmap, tile } of rainLayers) {
            context.drawImage(
              bitmap,
              panelX + Math.round(tile.destX * scaleX),
              Math.round(tile.destY * scaleY),
              Math.ceil(256 * scaleX),
              Math.ceil(256 * scaleY),
            );
          }
          context.drawImage(kawagoeMask, panelX, 0, panelWidth, payload.outputHeight);
        }
        for (const { bitmap } of rainLayers) bitmap.close?.();
      }

      sunnyIcon?.close?.();
      satellite.close?.();
      if (payload.kawagoeMaskUrl) kawagoeMask.close?.();

      context.fillStyle = "rgba(0,0,0,0.92)";
      for (let divider = 1; divider < payload.panels.length; divider += 1) {
        context.fillRect(divider * panelWidth - 1, 0, 3, payload.outputHeight);
      }

      for (let panelIndex = 0; panelIndex < payload.panels.length; panelIndex += 1) {
        const panel = payload.panels[panelIndex]!;
        const panelX = panelIndex * panelWidth;
        drawPanelLabel(panel, panelX);
      }
      return { generatedMaskDataUrl };
    }, {
      outputWidth: request.outputWidth,
      outputHeight: request.outputHeight,
      panels: panelResults,
      satelliteUrl: `${publicOrigin}${SATELLITE_ASSET_PATH}`,
      sunnyIconUrl: `${publicOrigin}${SUNNY_ICON_ASSET_PATH}`,
      kawagoeMaskUrl: storedMask ? `${publicOrigin}${KAWAGOE_MASK_PATH}` : "",
      boundary,
      analysisWidth: RAIN_ANALYSIS_WIDTH,
      analysisHeight: RAIN_ANALYSIS_HEIGHT,
    });

    if (evaluation.generatedMaskDataUrl && env.UPDATE_BUCKET) {
      await env.UPDATE_BUCKET.put(
        KAWAGOE_MASK_KEY,
        decodePngDataUrl(evaluation.generatedMaskDataUrl),
        {
          httpMetadata: { contentType: "image/png" },
          customMetadata: { version: "kawagoe-z9-480x960-v1" },
        },
      );
    }

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
