import {
  appendEmptyTableRow,
  byId,
  integerFormat,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';

const SERVICE = 'genie';
const SERVICE_TITLE = '지니뮤직';
const CADENCE = '毎週月曜日0:00';
const ARTIST_LABELS = Object.freeze({
  sakurazaka46: '櫻坂46',
  nogizaka46: '乃木坂46',
  hinatazaka46: '日向坂46',
});
const ARTIST_ORDER = ['sakurazaka46', 'nogizaka46', 'hinatazaka46'];

let readModelPromise = null;
let requestId = 0;
let activeArtistFilter = 'all';
let lastPayload = null;
let routeObserver = null;
let mountObserver = null;
let enforcing = false;

function routeVisible() {
  return location.hash.slice(1) === SERVICE;
}

function updatedText(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(time));
}

function valueText(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? integerFormat.format(number) : String(value);
}

function artistPosition(artist) {
  const index = ARTIST_ORDER.indexOf(artist);
  return index < 0 ? ARTIST_ORDER.length : index;
}

function replaceBody(id) {
  const node = byId(id);
  if (node) node.replaceChildren();
  return node;
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = String(text ?? '-');
  return td;
}

function row(values) {
  const tr = document.createElement('tr');
  values.forEach((value) => tr.append(cell(value)));
  return tr;
}

function mountSection() {
  if (byId('genieCatalogSection')) return true;
  const tables = byId('regionalMusicGenericTables');
  if (!tables) return false;
  tables.insertAdjacentHTML('beforebegin', `
    <section id="genieCatalogSection" class="music-service-section regional-chart-section" hidden>
      <div class="regional-chart-section-head">
        <div><h2>지니뮤직 全曲</h2></div>
        <div class="mode-tabs regional-chart-filter" role="group" aria-label="지니뮤직 表示グループ">
          <button type="button" class="active" data-genie-artist-filter="all" aria-pressed="true">すべて</button>
          <button type="button" data-genie-artist-filter="sakurazaka46" aria-pressed="false">櫻坂</button>
          <button type="button" data-genie-artist-filter="nogizaka46" aria-pressed="false">乃木坂</button>
          <button type="button" data-genie-artist-filter="hinatazaka46" aria-pressed="false">日向坂</button>
        </div>
      </div>
      <div class="regional-music-table-wrap">
        <table class="regional-music-table regional-music-qq-popularity-table music-service-track-table">
          <thead><tr><th>グループ</th><th>順位</th><th>曲名</th><th>再生数</th><th>リスナー</th><th>いいね</th></tr></thead>
          <tbody id="genieCatalogBody"></tbody>
        </table>
      </div>
    </section>`);
  bindFilters();
  installRouteObserver();
  return true;
}

function setSectionVisible(visible) {
  const section = byId('genieCatalogSection');
  if (section) section.hidden = !visible;
}

function assertCompact() {
  if (!routeVisible() || enforcing) return;
  enforcing = true;
  try {
    const view = byId('regionalMusicView');
    if (view && !view.classList.contains('is-chart-compact')) view.classList.add('is-chart-compact');
    const genericHeader = byId('regionalMusicGenericHeader');
    const genericTables = byId('regionalMusicGenericTables');
    const compactMeta = byId('regionalMusicCompactMeta');
    const genericNotice = byId('regionalMusicNotice');
    if (genericHeader && !genericHeader.hidden) genericHeader.hidden = true;
    if (genericTables && !genericTables.hidden) genericTables.hidden = true;
    if (compactMeta && compactMeta.hidden) compactMeta.hidden = false;
    if (genericNotice && !genericNotice.hidden) genericNotice.hidden = true;
    setText('regionalMusicTitle', SERVICE_TITLE);
    setText('regionalMusicChartCadence', CADENCE);
  } finally {
    enforcing = false;
  }
}

function installRouteObserver() {
  if (routeObserver) return;
  const view = byId('regionalMusicView');
  if (!view) return;
  routeObserver = new MutationObserver(() => {
    if (routeVisible()) queueMicrotask(assertCompact);
  });
  routeObserver.observe(view, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
}

async function loadReadModel() {
  if (!readModelPromise) {
    readModelPromise = fetch('/api/regional-music?service=genie', {
      headers: { accept: 'application/json' },
      cache: 'default',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`regional music Genie HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok || payload.service !== SERVICE) {
        throw new Error(payload?.error || 'Genie read model unavailable');
      }
      return payload;
    }).catch((error) => {
      readModelPromise = null;
      throw error;
    });
  }
  return readModelPromise;
}

function artistVisible(canonicalArtist) {
  return activeArtistFilter === 'all' || canonicalArtist === activeArtistFilter;
}

function syncFilterButtons() {
  for (const button of document.querySelectorAll('[data-genie-artist-filter]')) {
    const active = button.dataset.genieArtistFilter === activeArtistFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function bindFilters() {
  for (const button of document.querySelectorAll('[data-genie-artist-filter]')) {
    if (button.dataset.genieFilterBound === '1') continue;
    button.dataset.genieFilterBound = '1';
    button.addEventListener('click', () => {
      activeArtistFilter = button.dataset.genieArtistFilter || 'all';
      if (lastPayload && routeVisible()) render(lastPayload);
      else syncFilterButtons();
    });
  }
}

function catalogRows(payload) {
  const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
  const orders = Array.isArray(payload?.artist_track_orders) ? payload.artist_track_orders : [];
  const trackById = new Map(tracks
    .filter((item) => item?.service === SERVICE)
    .map((item) => [String(item.service_track_id || ''), item]));

  const ranked = orders
    .filter((item) => item?.service === SERVICE)
    .filter((item) => ARTIST_ORDER.includes(item?.canonical_artist))
    .filter((item) => artistVisible(item?.canonical_artist))
    .filter((item) => Number.isFinite(Number(item?.position)) && Number(item.position) > 0)
    .map((item) => ({ order: item, track: trackById.get(String(item.service_track_id || '')) || null }));

  if (ranked.length) {
    return ranked.sort((a, b) => artistPosition(a.order.canonical_artist) - artistPosition(b.order.canonical_artist)
      || Number(a.order.position) - Number(b.order.position)
      || String(a.track?.title || '').localeCompare(String(b.track?.title || '')));
  }

  return tracks
    .filter((item) => item?.service === SERVICE)
    .filter((item) => ARTIST_ORDER.includes(item?.canonical_artist))
    .filter((item) => artistVisible(item?.canonical_artist))
    .map((track) => ({
      order: {
        canonical_artist: track.canonical_artist,
        position: track.popularity_rank,
        service_track_id: track.service_track_id,
      },
      track,
    }))
    .sort((a, b) => artistPosition(a.order.canonical_artist) - artistPosition(b.order.canonical_artist)
      || Number(a.order.position || Infinity) - Number(b.order.position || Infinity)
      || String(a.track?.title || '').localeCompare(String(b.track?.title || '')));
}

function renderCatalog(payload) {
  const body = replaceBody('genieCatalogBody');
  if (!body) return;
  const rows = catalogRows(payload);
  if (!rows.length) {
    appendEmptyTableRow(body, '지니뮤직 の楽曲データはありません。', 6);
    return;
  }
  for (const item of rows) {
    const rank = Number(item.order.position);
    body.append(row([
      ARTIST_LABELS[item.order.canonical_artist] || item.order.canonical_artist || '-',
      Number.isFinite(rank) && rank > 0 ? `${integerFormat.format(rank)}位` : '-',
      item.track?.title || item.order.service_track_id || '-',
      valueText(item.track?.plays),
      valueText(item.track?.listeners),
      valueText(item.track?.likes),
    ]));
  }
}

function render(payload) {
  lastPayload = payload;
  assertCompact();
  syncFilterButtons();
  setText('regionalMusicChartUpdated', updatedText(payload?.updated_at));
  renderCatalog(payload);
}

async function renderForRoute() {
  const id = ++requestId;
  if (!mountSection()) return;
  const visible = routeVisible();
  setSectionVisible(visible);
  if (!visible) return;
  assertCompact();
  replaceBody('genieCatalogBody');
  try {
    const payload = await loadReadModel();
    if (id !== requestId || !routeVisible()) return;
    render(payload);
  } catch {
    if (id !== requestId || !routeVisible()) return;
    const body = replaceBody('genieCatalogBody');
    if (body) appendEmptyTableRow(body, '지니뮤직 の全曲データを取得できませんでした。', 6);
  }
}

function init() {
  if (mountSection()) void renderForRoute();
  if (!mountObserver) {
    mountObserver = new MutationObserver(() => {
      if (mountSection()) {
        mountObserver.disconnect();
        mountObserver = null;
        void renderForRoute();
      }
    });
    mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.addEventListener('hashchange', renderForRoute);
  window.addEventListener('popstate', renderForRoute);
  window.addEventListener('dashboard:route-ready', renderForRoute);
}

init();
