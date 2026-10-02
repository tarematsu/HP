import {
  appendEmptyTableRow,
  byId,
  integerFormat,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';
import { renderRankHistoryChart } from './dashboard-rank-chart.js?v=20261002.1';

const ARTIST_LABELS = Object.freeze({
  sakurazaka46: '櫻坂46',
  nogizaka46: '乃木坂46',
  hinatazaka46: '日向坂46',
});
const GROUP_COLORS = Object.freeze({
  sakurazaka46: '#f3a6c8',
  nogizaka46: '#8264b0',
  hinatazaka46: '#9ecff3',
});
const ARTIST_ORDER = ['sakurazaka46','nogizaka46','hinatazaka46'];
const OUT_OF_CHART_RANK = 101;

let readModelPromise = null;
let requestId = 0;
let activeArtistFilter = 'all';
let lastPayload = null;
let routeObserver = null;
let mountObserver = null;
let enforcing = false;

function providerDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function shortDate(value) {
  const date = providerDate(value);
  return date ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : String(value || '');
}

function dateText(value) {
  const date = providerDate(value);
  return date ? date.replaceAll('-', '/') : '-';
}

function updatedText(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false,
  }).format(new Date(time));
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

function routeVisible() {
  return location.hash.slice(1) === 'netease_cloud_music';
}

function mountSections() {
  if (byId('neteaseJapanChartSection')) return true;
  const tables = byId('regionalMusicGenericTables');
  if (!tables) return false;
  tables.insertAdjacentHTML('beforebegin', `
    <section id="neteaseJapanChartSection" class="music-service-section regional-chart-section" hidden>
      <div class="regional-chart-section-head"><h2>网易云日语榜 グループ別最高順位推移</h2></div>
      <div id="neteaseJapanRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div>
      <div id="neteaseJapanRankChart" class="regional-music-rank-chart"></div>
    </section>
    <section id="neteaseJapanHistorySection" class="music-service-section regional-chart-section" hidden>
      <div class="regional-chart-section-head">
        <h2>网易云日语榜 ランクイン履歴</h2>
        <div class="mode-tabs regional-chart-filter" role="group" aria-label="网易云日语榜 表示グループ">
          <button type="button" class="active" data-netease-artist-filter="all" aria-pressed="true">すべて</button>
          <button type="button" data-netease-artist-filter="sakurazaka46" aria-pressed="false">櫻坂</button>
          <button type="button" data-netease-artist-filter="nogizaka46" aria-pressed="false">乃木坂</button>
          <button type="button" data-netease-artist-filter="hinatazaka46" aria-pressed="false">日向坂</button>
        </div>
      </div>
      <div class="regional-music-table-wrap">
        <table class="regional-music-table regional-music-kugou-history-table regional-music-netease-history-table music-service-track-table">
          <thead><tr><th>更新日</th><th>グループ</th><th>順位</th><th>曲名</th></tr></thead>
          <tbody id="neteaseJapanHistoryBody"></tbody>
        </table>
      </div>
    </section>`);
  bindFilters();
  installRouteObserver();
  return true;
}

function setSectionsVisible(visible) {
  for (const id of ['neteaseJapanChartSection','neteaseJapanHistorySection']) {
    const section = byId(id);
    if (section) section.hidden = !visible;
  }
}

function assertCompact() {
  if (!routeVisible() || enforcing) return;
  enforcing = true;
  try {
    byId('regionalMusicView')?.classList.add('is-chart-compact');
    const genericHeader = byId('regionalMusicGenericHeader');
    const genericTables = byId('regionalMusicGenericTables');
    const compactMeta = byId('regionalMusicCompactMeta');
    if (genericHeader) genericHeader.hidden = true;
    if (genericTables) genericTables.hidden = true;
    if (compactMeta) compactMeta.hidden = false;
    setText('regionalMusicTitle','网易云音乐');
    setText('regionalMusicChartCadence','毎週火曜（网易云日语榜更新）');
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
  routeObserver.observe(view, { subtree:true, attributes:true, attributeFilter:['hidden','class'] });
}

async function loadReadModel() {
  if (!readModelPromise) {
    readModelPromise = fetch('/api/regional-music', {
      headers:{ accept:'application/json' }, cache:'default',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`regional music HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok) throw new Error(payload?.error || 'regional music read model unavailable');
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
  for (const button of document.querySelectorAll('[data-netease-artist-filter]')) {
    const active = button.dataset.neteaseArtistFilter === activeArtistFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function bindFilters() {
  for (const button of document.querySelectorAll('[data-netease-artist-filter]')) {
    if (button.dataset.neteaseFilterBound === '1') continue;
    button.dataset.neteaseFilterBound = '1';
    button.addEventListener('click', () => {
      activeArtistFilter = button.dataset.neteaseArtistFilter || 'all';
      if (lastPayload && routeVisible()) render(lastPayload);
      else syncFilterButtons();
    });
  }
}

function storedPeriods(chart, history) {
  const byPeriod = new Map();
  for (const item of Array.isArray(chart?.periods) ? chart.periods : []) {
    const period = providerDate(item?.period || item?.published_at);
    if (period) byPeriod.set(period, { period, date:providerDate(item?.published_at) || period });
  }
  if (!byPeriod.size) {
    for (const item of history) {
      const period = providerDate(item?.period || item?.published_at);
      if (period && !byPeriod.has(period)) byPeriod.set(period,{period,date:providerDate(item?.published_at) || period});
    }
  }
  return [...byPeriod.values()].sort((a,b) => a.period.localeCompare(b.period));
}

function chartSeries(history, periods) {
  return ARTIST_ORDER.filter(artistVisible).map((canonicalArtist) => {
    const byPeriod = new Map();
    for (const item of history) {
      if (item?.canonical_artist !== canonicalArtist) continue;
      const period = providerDate(item?.period || item?.published_at);
      const rank = Number(item?.rank);
      if (!period || !Number.isFinite(rank) || rank < 1) continue;
      const previous = byPeriod.get(period);
      if (!previous || rank < previous.rank) byPeriod.set(period,{rank});
    }
    return {
      id:canonicalArtist,
      title:ARTIST_LABELS[canonicalArtist],
      color:GROUP_COLORS[canonicalArtist],
      points:periods.map(({period,date}) => ({date,rank:byPeriod.get(period)?.rank ?? OUT_OF_CHART_RANK})),
    };
  }).filter((series) => series.points.length);
}

function renderHistory(history) {
  const body = replaceBody('neteaseJapanHistoryBody');
  if (!body) return;
  const ordered = history
    .filter((item) => artistVisible(item?.canonical_artist))
    .sort((a,b) => String(b.period || '').localeCompare(String(a.period || '')) || Number(a.rank)-Number(b.rank));
  if (!ordered.length) {
    appendEmptyTableRow(body,'网易云日语榜のランクイン履歴はありません。',4);
    return;
  }
  for (const item of ordered) {
    body.append(row([
      dateText(item.published_at || item.period),
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      Number.isFinite(Number(item.rank)) ? `${integerFormat.format(Number(item.rank))}位` : '-',
      item.title || '-',
    ]));
  }
}

function render(payload) {
  lastPayload = payload;
  assertCompact();
  syncFilterButtons();
  setText('regionalMusicChartUpdated',updatedText(payload?.updated_at));
  const chart = payload?.netease_japan_chart || {};
  const history = Array.isArray(chart.history) ? chart.history : [];
  const periods = storedPeriods(chart,history);
  renderRankHistoryChart({
    container:byId('neteaseJapanRankChart'),
    series:chartSeries(history,periods),
    dates:periods.map((item)=>item.date),
    height:320,
    margin:{left:58,right:18,top:12,bottom:34},
    yMax:OUT_OF_CHART_RANK,
    rankTicks:[1,25,50,75,100,OUT_OF_CHART_RANK],
    dateTickCount:5,
    ariaLabel:'网易云日语榜における選択グループの各週最高順位推移。保存済み週の圏外も含み、1位が上。',
    lineClass:'kugou-rank-line',
    emptyClass:'regional-music-rank-empty',
    emptyText:'网易云日语榜の順位履歴はまだありません。',
    rankLabel:(rank)=>rank===OUT_OF_CHART_RANK ? '圏外' : `${rank}位`,
    dateLabel:shortDate,
    latestPoint:{radius:()=>2.5},
    legendContainer:byId('neteaseJapanRankLegend'),
  });
  renderHistory(history);
}

async function renderForRoute() {
  const id = ++requestId;
  if (!mountSections()) return;
  const visible = routeVisible();
  setSectionsVisible(visible);
  if (!visible) return;
  assertCompact();
  replaceBody('neteaseJapanRankLegend');
  replaceBody('neteaseJapanRankChart');
  replaceBody('neteaseJapanHistoryBody');
  try {
    const payload = await loadReadModel();
    if (id !== requestId || !routeVisible()) return;
    render(payload);
  } catch {
    if (id !== requestId || !routeVisible()) return;
    const body = replaceBody('neteaseJapanHistoryBody');
    if (body) appendEmptyTableRow(body,'网易云日语榜の履歴を取得できませんでした。',4);
  }
}

function init() {
  if (mountSections()) void renderForRoute();
  if (!mountObserver) {
    mountObserver = new MutationObserver(() => {
      if (mountSections()) {
        mountObserver.disconnect();
        mountObserver = null;
        void renderForRoute();
      }
    });
    mountObserver.observe(document.documentElement,{childList:true,subtree:true});
  }
  window.addEventListener('hashchange',renderForRoute);
  window.addEventListener('popstate',renderForRoute);
  window.addEventListener('dashboard:route-ready',renderForRoute);
}

init();
