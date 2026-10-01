import {
  byId as element,
  fullDate as formatFullDate,
  integerFormat as numberFormat,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate as formatDate,
  signedInteger,
} from './dashboard-ui-common.js?v=20260930.1';
import { renderRankHistoryChart } from './dashboard-rank-chart.js?v=20261001.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';

let loadPromise = null;
let lastPayload = null;
let activeMode = 'all';

const MODE_GROUPS = Object.freeze({ nogizaka: '乃木坂46', sakurazaka: '櫻坂46', hinatazaka: '日向坂46' });
const GROUPS = new Set(Object.values(MODE_GROUPS));
const isTitleTrack = (track) => track?.is_title_track === true;
const setNotice = (message = '', error = false) => setSharedNotice('amazonMusicNotice', message, error);

function modeCopy(mode) {
  const group = MODE_GROUPS[mode];
  if (group) return {
    chartTitle: `${group} 表題曲 Amazon Music総合順位推移`,
    tableTitle: `${group} 全楽曲順位`,
    ariaLabel: `${group}表題曲のAmazon Music総合順位推移。1位が上。`,
  };
  if (mode === 'titles') return {
    chartTitle: '表題曲 Amazon Music総合順位推移',
    tableTitle: '表題曲比較',
    ariaLabel: '坂道3グループ表題曲のAmazon Music総合順位推移。1位が上。',
  };
  return {
    chartTitle: 'Amazon Music総合順位推移（各グループ上位5曲）',
    tableTitle: '全楽曲順位',
    ariaLabel: '坂道3グループ全楽曲のAmazon Music総合順位推移。1位が上。',
  };
}

function trackKey(track) {
  const amazonId = String(track?.amazon_music_id || '').trim();
  if (amazonId) return `amazon:${amazonId}`;
  const trackId = integer(track?.track_id);
  return trackId != null && trackId > 0 ? `track:${trackId}` : '';
}

function filteredPayload(payload, predicate) {
  const tracks = (Array.isArray(payload?.tracks) ? payload.tracks : []).filter(predicate);
  const keys = new Set(tracks.map(trackKey).filter(Boolean));
  return {
    ...payload,
    tracks,
    history: (Array.isArray(payload?.history) ? payload.history : []).map((point) => ({
      ...point,
      tracks: (Array.isArray(point?.tracks) ? point.tracks : []).filter((track) => keys.has(trackKey(track))),
    })),
  };
}

function tablePayload(payload, mode) {
  if (mode === 'titles') return filteredPayload(payload, isTitleTrack);
  const group = MODE_GROUPS[mode];
  return filteredPayload(payload, group
    ? (track) => track?.group_name === group
    : (track) => GROUPS.has(track?.group_name));
}

function chartPayload(payload, mode) {
  const group = MODE_GROUPS[mode];
  if (group) return filteredPayload(payload, (track) => track?.group_name === group && isTitleTrack(track));
  if (mode === 'titles') return filteredPayload(payload, isTitleTrack);
  const selected = new Set();
  for (const name of GROUPS) {
    const ranked = (payload?.tracks || [])
      .filter((track) => track?.group_name === name && integer(track?.amazon_rank) > 0)
      .sort((left, right) => Number(left.amazon_rank) - Number(right.amazon_rank));
    for (const track of ranked.slice(0, 5)) selected.add(trackKey(track));
  }
  return filteredPayload(payload, (track) => selected.has(trackKey(track)));
}

function trackTitleMap(payload) {
  return new Map((Array.isArray(payload?.tracks) ? payload.tracks : [])
    .map((track) => [trackKey(track), track?.display_title || track?.title || '曲名不明'])
    .filter(([key]) => key));
}

function latestRanks(payload, metricKey) {
  const result = new Map();
  for (const track of Array.isArray(payload?.tracks) ? payload.tracks : []) {
    const id = trackKey(track);
    const rank = integer(track?.[metricKey]);
    if (id && rank != null && rank > 0) result.set(id, rank);
  }
  return result;
}

function normalizeSeries(payload, metricKey) {
  const titles = trackTitleMap(payload);
  const currentRanks = latestRanks(payload, metricKey);
  const byTrack = new Map();
  for (const point of Array.isArray(payload?.history) ? payload.history : []) {
    const date = String(point?.snapshot_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const track of Array.isArray(point?.tracks) ? point.tracks : []) {
      const id = trackKey(track);
      const rank = integer(track?.[metricKey]);
      if (!id || rank == null || rank < 1) continue;
      if (!byTrack.has(id)) byTrack.set(id, []);
      byTrack.get(id).push({ date, rank });
    }
  }
  return [...byTrack.entries()].map(([id, points]) => ({
    id,
    title: titles.get(id) || id,
    currentRank: currentRanks.get(id) ?? null,
    points: points.sort((a, b) => a.date.localeCompare(b.date)),
  })).sort((a, b) => {
    const ar = a.currentRank ?? Number.MAX_SAFE_INTEGER;
    const br = b.currentRank ?? Number.MAX_SAFE_INTEGER;
    return ar - br || a.title.localeCompare(b.title, 'ja');
  });
}

function renderRankChart(payload, { containerId, metricKey, emptyText, ariaLabel }) {
  const container = element(containerId);
  if (!container) return;
  const series = normalizeSeries(payload, metricKey);
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  const ranks = series.flatMap((item) => item.points.map((point) => point.rank));
  const maxRank = Math.max(1, ...ranks);
  const yMax = Math.max(5, Math.ceil(maxRank / 5) * 5);
  const rankTicks = [...new Set([1, ...[0.25, 0.5, 0.75, 1]
    .map((ratio) => Math.max(1, Math.round(yMax * ratio)))])].sort((a, b) => a - b);

  renderRankHistoryChart({
    container,
    series,
    dates,
    width: 960,
    height: 420,
    margin: { left: 58, right: 18, top: 18, bottom: 38 },
    yMax,
    rankTicks,
    dateTickCount: 5,
    ariaLabel,
    svgClass: 'amazon-rank-svg',
    gridClass: 'amazon-rank-grid',
    axisClass: 'amazon-rank-axis-label',
    lineClass: 'amazon-rank-line',
    pointClass: 'amazon-rank-point',
    emptyClass: 'amazon-rank-empty',
    emptyText,
    rankLabel: (rank) => `${rank}位`,
    dateLabel: formatDate,
    hueVariable: '--amazon-rank-hue',
    hueStep: 47,
    lineTitle: (item) => `${item.title}${item.currentRank == null ? '' : ` 現在${item.currentRank}位`}`,
    latestPoint: {
      radius: (item) => item.currentRank != null ? 2.5 : 1.8,
      title: (item, latest) => `${item.title} ${formatFullDate(latest.date)} ${latest.rank}位`,
    },
    legendContainer: element('amazonRankLegend'),
  });
}

function renderSummary(payload) {
  const date = element('amazonSnapshotDate');
  const count = element('amazonTrackCount');
  if (date) date.textContent = formatFullDate(payload?.snapshot_date);
  if (count) count.textContent = numberFormat.format((Array.isArray(payload?.tracks) ? payload.tracks : []).length);
}

function renderTable(payload) {
  const tbody = element('amazonMusicTbody');
  if (!tbody) return;
  tbody.replaceChildren();
  const tracks = [...(Array.isArray(payload?.tracks) ? payload.tracks : [])].sort((a, b) => {
    const ar = integer(a?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    const br = integer(b?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    return ar - br || String(a?.group_name || '').localeCompare(String(b?.group_name || ''), 'ja');
  });
  for (const track of tracks) {
    const amazon = integer(track?.amazon_rank);
    appendTableRow(tbody, [
      { text: amazon == null ? '-' : `${numberFormat.format(amazon)}位`, className: 'amazon-rank-number' },
      { text: signedInteger(track?.rank_change), className: 'amazon-rank-number' },
      { text: track?.group_name || '-', className: 'amazon-artist-name' },
      track?.display_title || track?.title || '曲名不明',
    ]);
  }
}

function renderModeButtons() {
  for (const button of document.querySelectorAll('[data-amazon-mode]')) {
    const selected = button.dataset.amazonMode === activeMode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
}

function bindModeButtons() {
  for (const button of document.querySelectorAll('[data-amazon-mode]')) {
    if (button.dataset.amazonBound === '1') continue;
    button.dataset.amazonBound = '1';
    button.addEventListener('click', () => {
      const mode = button.dataset.amazonMode;
      if ((!MODE_GROUPS[mode] && !['all', 'titles'].includes(mode)) || mode === activeMode) return;
      activeMode = mode;
      if (lastPayload) render(lastPayload);
    });
  }
}

function render(payload) {
  bindModeButtons();
  renderModeButtons();
  renderSummary(payload);
  const copy = modeCopy(activeMode);
  const chartTitle = element('amazonAllRankTitle');
  const tableTitle = element('amazonTracksTitle');
  if (chartTitle) chartTitle.textContent = copy.chartTitle;
  if (tableTitle) tableTitle.textContent = copy.tableTitle;
  renderRankChart(chartPayload(payload, activeMode), {
    containerId: 'amazonAllRankChart', metricKey: 'amazon_rank',
    emptyText: 'Amazon Music総合順位の履歴はまだありません。', ariaLabel: copy.ariaLabel,
  });
  renderTable(tablePayload(payload, activeMode));
}

async function fetchPayload() {
  const response = await fetch('/api/amazon-music', { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `Amazon Music API HTTP ${response.status}`);
  return payload;
}

export async function loadAmazonMusicView({ force = false } = {}) {
  if (!force && lastPayload) {
    render(lastPayload);
    return lastPayload;
  }
  if (!loadPromise || force) {
    loadPromise = fetchPayload().then((payload) => {
      lastPayload = payload;
      setNotice('');
      render(payload);
      return payload;
    }).catch((error) => {
      setNotice('Amazon Musicデータの取得に失敗しました。', true);
      throw error;
    }).finally(() => { loadPromise = null; });
  }
  return loadPromise;
}
