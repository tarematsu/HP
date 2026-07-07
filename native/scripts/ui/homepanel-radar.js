(() => {
  'use strict';

  const root = window.HomePanel;
  const { $, text } = root.utils;

  const RADAR_WIDTH = 800;
  const RADAR_HEIGHT = 520;
  const RADAR_VIEW_ZOOM = 11;
  const RADAR_RAIN_ZOOM = 10;
  const RADAR_RAIN_SCALE = 2 ** (RADAR_VIEW_ZOOM - RADAR_RAIN_ZOOM);
  const RADAR_LATITUDE = 35.891991;
  const RADAR_LONGITUDE = 139.486375;
  const RADAR_REFRESH_MS = 5 * 60 * 1000;
  const RADAR_METADATA_URL = 'https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json';

  let radarRefreshPromise = null;
  let radarSignatureValue = '';
  let radarFrame = null;
  let radarStaticLayers = null;

  function radarLayout(zoom, drawScale = 1) {
    const tileSize = 256;
    const scale = 2 ** zoom;
    const worldX = (RADAR_LONGITUDE + 180) / 360 * scale * tileSize;
    const latitude = Math.max(-85.05112878, Math.min(85.05112878, RADAR_LATITUDE)) * Math.PI / 180;
    const worldY = (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * scale * tileSize;
    const viewWidth = RADAR_WIDTH / drawScale;
    const viewHeight = RADAR_HEIGHT / drawScale;
    const left = worldX - viewWidth / 2;
    const top = worldY - viewHeight / 2;
    const tiles = [];
    for (let y = Math.floor(top / tileSize); y <= Math.floor((top + viewHeight - 1) / tileSize); y += 1) {
      for (let x = Math.floor(left / tileSize); x <= Math.floor((left + viewWidth - 1) / tileSize); x += 1) {
        tiles.push({
          x,
          y,
          left: Math.round((x * tileSize - left) * drawScale),
          top: Math.round((y * tileSize - top) * drawScale),
          size: tileSize * drawScale,
        });
      }
    }
    return tiles;
  }

  function loadRadarImage(url) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  function radarLayers() {
    if (!radarStaticLayers) {
      radarStaticLayers = Promise.all([
        loadRadarImage('radar-satellite.png'),
        loadRadarImage('radar-map.png'),
      ]).then(([satellite, map]) => {
        if (!satellite || !map) throw new Error('Bundled radar base layers are unavailable');
        return { satellite, map };
      }).catch(error => {
        radarStaticLayers = null;
        throw error;
      });
    }
    return radarStaticLayers;
  }

  function radarDate(value) {
    const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    if (!match) return null;
    return new Date(Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6]),
    ));
  }

  function presentRadar() {
    if (!radarFrame) return;
    const canvas = $('#radar-canvas');
    const context = canvas?.getContext('2d', { alpha: false, desynchronized: true });
    if (!canvas || !context) return;
    if (canvas.width !== RADAR_WIDTH) canvas.width = RADAR_WIDTH;
    if (canvas.height !== RADAR_HEIGHT) canvas.height = RADAR_HEIGHT;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'copy';
    context.globalAlpha = 1;
    context.drawImage(radarFrame, 0, 0);
    context.globalCompositeOperation = 'source-over';
  }

  async function buildRadarFrame() {
    const layers = await radarLayers();
    let latest = null;
    let overlays = [];

    try {
      const response = await fetch(`${RADAR_METADATA_URL}?_=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`JMA metadata HTTP ${response.status}`);
      const entries = await response.json();
      latest = (Array.isArray(entries) ? entries : [])
        .filter(entry => Array.isArray(entry.elements) && entry.elements.includes('hrpns'))
        .sort((left, right) => String(right.validtime || '').localeCompare(String(left.validtime || '')))[0];
      if (!latest?.basetime || !latest?.validtime) throw new Error('JMA latest radar frame is unavailable');

      const date = radarDate(latest.validtime);
      if (date) {
        text('#radar-time', date.toLocaleTimeString('ja-JP', {
          hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
        }));
      }

      const signature = `${latest.basetime}:${latest.validtime}`;
      if (signature === radarSignatureValue && radarFrame) {
        presentRadar();
        return;
      }

      const tiles = radarLayout(RADAR_RAIN_ZOOM, RADAR_RAIN_SCALE);
      overlays = (await Promise.all(tiles.map(async tile => ({
        tile,
        image: await loadRadarImage(
          `https://www.jma.go.jp/bosai/jmatile/data/nowc/${latest.basetime}/none/${latest.validtime}/surf/hrpns/${RADAR_RAIN_ZOOM}/${tile.x}/${tile.y}.png`,
        ),
      })))).filter(entry => entry.image);
    } catch (_) {
      latest = null;
      overlays = [];
      if (radarFrame) {
        presentRadar();
        return;
      }
    }

    const frame = document.createElement('canvas');
    frame.width = RADAR_WIDTH;
    frame.height = RADAR_HEIGHT;
    const context = frame.getContext('2d', { alpha: false });
    if (!context) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, RADAR_WIDTH, RADAR_HEIGHT);
    context.drawImage(layers.satellite, 0, 0, RADAR_WIDTH, RADAR_HEIGHT);

    context.imageSmoothingEnabled = false;
    overlays.forEach(({ tile, image }) => context.drawImage(image, tile.left, tile.top, tile.size, tile.size));

    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(layers.map, 0, 0, RADAR_WIDTH, RADAR_HEIGHT);

    if (latest) radarSignatureValue = `${latest.basetime}:${latest.validtime}`;
    else text('#radar-time', '--:--');
    radarFrame = frame;
    presentRadar();
  }

  function refreshRadar() {
    if (radarRefreshPromise) return radarRefreshPromise;
    radarRefreshPromise = buildRadarFrame()
      .catch(() => {
        if (!radarFrame) text('#radar-time', '--:--');
      })
      .finally(() => {
        radarRefreshPromise = null;
      });
    return radarRefreshPromise;
  }

  root.panels = root.panels || {};
  root.panels.radar = { refreshRadar, presentRadar, refreshMs: RADAR_REFRESH_MS };
})();
