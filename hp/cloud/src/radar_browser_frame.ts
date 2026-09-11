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
const KAWAGOE_BOUNDARY_URL = "https://geoshape.ex.nii.ac.jp/city/geojson/latest/11201.geojson";

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

export async function renderRepresentativeRadarFrame(
  env: Env,
  request: BrowserRadarRenderRequest,
): Promise<BrowserRadarRenderResult> {
  const browserBinding = (env as BrowserBindingEnv).BROWSER;
  if (!browserBinding) throw new Error("Cloudflare Browser Run binding is unavailable");
  const publicOrigin = originUrl(request.publicUrl);
  const boundary = await fetchKawagoeBoundary();
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

      const drawBase = (bitmap: any, panel: any, panelX: number) => {
        // The bundled satellite is a z10 layer centered on Kawagoe. Crop the
        // exact z10 pixel extent corresponding to the z9 rain source.
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

      const tileReference = (panel: any) => {
        const tile = panel.tiles?.[0];
        if (!tile?.url) return null;
        try {
          const parts = String(tile.url).split("?", 1)[0]!.split("/").filter(Boolean);
          if (parts.length < 3) return null;
          const zoom = Number(parts.at(-3));
          const tileX = Number(parts.at(-2));
          const tileY = Number(String(parts.at(-1)).replace(/\.png$/, ""));
          if (![zoom, tileX, tileY].every(Number.isFinite)) return null;
          return { zoom, tileX, tileY, destX: tile.destX, destY: tile.destY };
        } catch {
          return null;
        }
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
      const addBoundaryPath = (panel: any, panelX: number) => {
        if (!boundaryPolygons.length) return false;
        const reference = tileReference(panel);
        if (!reference) return false;
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
              const world = worldPixel(lon, lat, reference.zoom);
              const sourceX = reference.destX + world.x - reference.tileX * 256;
              const sourceY = reference.destY + world.y - reference.tileY * 256;
              const x = panelX + sourceX * scaleX;
              const y = sourceY * scaleY;
              if (first) {
                context.moveTo(x, y);
                first = false;
              } else {
                context.lineTo(x, y);
              }
              drewPoint = true;
            }
            if (!first) context.closePath();
          }
        }
        return drewPoint;
      };
      const drawKawagoeMask = (panel: any, panelX: number) => {
        context.save();
        context.beginPath();
        context.rect(panelX, 0, panelWidth, payload.outputHeight);
        if (!addBoundaryPath(panel, panelX)) {
          context.restore();
          return false;
        }
        context.fillStyle = "rgba(96,96,96,0.68)";
        context.fill("evenodd");
        context.restore();

        context.save();
        context.beginPath();
        if (!addBoundaryPath(panel, panelX)) {
          context.restore();
          return false;
        }
        context.strokeStyle = "rgba(255,255,255,0.98)";
        context.lineWidth = 5;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.stroke();
        context.restore();
        return true;
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

        // Fixed compositing order: satellite -> rain -> Kawagoe-only mask.
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
        // Never fall back to the legacy radar-map.png here: it is an opaque,
        // pre-Kawagoe map layer and can hide the rain tiles beneath it.
        drawKawagoeMask(panel, panelX);
      }

      satellite.close?.();

      context.fillStyle = "rgba(0,0,0,0.92)";
      for (let divider = 1; divider < payload.panels.length; divider += 1) {
        context.fillRect(divider * panelWidth - 2, 0, 4, payload.outputHeight);
      }

      // Labels are a final pass so no rain/mask layer can ever cover the time.
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
      boundary,
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
