import {
  byId as element,
  fullDate as formatFullDate,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate as formatDate,
} from './dashboard-ui-common.js?v=20261001.1';
import { renderRankHistoryChart } from './dashboard-rank-chart.js?v=20261001.1';
import { appendTableRow, replaceTableHeader } from './dashboard-table-dom.js?v=20261001.1';

const REGION_ORDER = Object.freeze(['jp', 'tw', 'hk', 'kr', 'sg', 'th', 'us']);
const JAPAN_RANK_LIMIT = 12;
const JAPAN_OUTSIDE_RANK = JAPAN_RANK_LIMIT + 1;
const DEFAULT_ARTIST_KEY = 'sakurazaka46';
let selectedArtistKey = DEFAULT_ARTIST_KEY;
let loadPromise = null;
let lastPayload = null;

function playlistModuleUrl() {
  return ['/apple-music-playlists.js', 'v=20261001.1'].join('?');
}

function loadPlaylistMemberships(force = false) {
  void import(playlistModuleUrl())
    .then((module) => module.loadAppleMusicPlaylistMemberships?.({ force }))
    .catch((error) => console.warn('Apple Music playlist view failed to load', error));
}

function trackKey(track) {
  const trackId = integer(track?.track_id);
  if (trackId != null) return `track:${trackId}`;
  return String(track?.song_key || track?.apple_music_id || '');
}

const setNotice = (message = '', error = false) => setSharedNotice('appleMusicNotice', message, error);

function artistModels(payload) {
  const models = Array.isArray(payload?.artists) ? payload.artists.filter((artist) => artist?.key) : [];
  if (models.length) return models;
  return [{
    key: DEFAULT_ARTIST_KEY,
    artist_key: DEFAULT_ARTIST_KEY,
    artist_id: payload?.artist_id || null,
    artist_name: payload?.artist_name || '櫻坂46',
    snapshot_date: payload?.snapshot_date || null,
    observed_at: payload?.observed_at || null,
    regions: Array.isArray(payload?.regions) ? payload.regions : [],
    failed_regions: Array.isArray(payload?.failed_regions) ? payload.failed_regions : [],
    history: Array.isArray(payload?.history) ? payload.history : [],
  }];
}

function activeArtist(payload) {
  const artists = artistModels(payload);
  return artists.find((artist) => artist.key === selectedArtistKey)
    || artists.find((artist) => artist.key === DEFAULT_ARTIST_KEY)
    || artists[0];
}

function activePayload(payload) {
  const artist = activeArtist(payload);
  if (!artist) return payload;
  return {
    ...payload,
    artist_id: artist.artist_id,
    artist_name: artist.artist_name,
    snapshot_date: artist.snapshot_date,
    observed_at: artist.observed_at,
    regions: Array.isArray(artist.regions) ? artist.regions : [],
    failed_regions: Array.isArray(artist.failed_regions) ? artist.failed_regions : [],
    history: Array.isArray(artist.history) ? artist.history : [],
  };
}

function regions(payload) {
  return Array.isArray(payload?.regions) ? payload.regions : [];
}

function regionByCode(payload, code) {
  return regions(payload).find((region) => region?.code === code) || null;
}

function orderedRegions(payload) {
  const byCode = new Map(regions(payload).map((region) => [region?.code, region]));
  return [
    ...REGION_ORDER.map((code) => byCode.get(code)).filter(Boolean),
    ...regions(payload).filter((region) => !REGION_ORDER.includes(region?.code)),
  ];
}

function renderArtistState(payload) {
  const artist = activeArtist(payload);
  const artistName = artist?.artist_name || '櫻坂46';
  document.querySelectorAll('[data-apple-artist]').forEach((button) => {
    const active = button.dataset.appleArtist === artist?.key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const rankTitle = element('appleJapanRankTitle');
  if (rankTitle) rankTitle.textContent = `${artistName} 日本の人気曲順位推移`;
  const tableTitle = element('appleRegionCompareTitle');
  if (tableTitle) tableTitle.textContent = `${artistName} 地域別人気順位一覧`;
}

function renderSummary(payload) {
  const count = element('appleRegionCount');
  const date = element('appleSnapshotDate');
  if (count) count.textContent = `${regions(payload).length}地域`;
  if (date) date.textContent = formatFullDate(payload?.snapshot_date);
}

function rankLabel(rank) {
  if (rank === JAPAN_OUTSIDE_RANK) return '圏外';
  return rank == null ? '-' : `${rank}位`;
}

function japanHistorySeries(payload) {
  const japan = regionByCode(payload, 'jp');
  const currentTracks = Array.isArray(japan?.tracks) ? japan.tracks : null;
  const history = Array.isArray(payload?.history) ? payload.history : [];
  const series = new Map();

  for (const point of history) {
    const date = String(point.snapshot_date);
    const tracks = Array.isArray(point?.regions?.jp) ? point.regions.jp : null;
    if (!tracks) {
      for (const item of series.values()) item.points.push({ date, rank: null });
      continue;
    }
    const ranks = new Map(tracks.map((track, index) => [trackKey(track), integer(track?.rank) ?? index + 1]));
    for (const item of series.values()) item.points.push({ date, rank: ranks.get(item.id) ?? JAPAN_OUTSIDE_RANK });
    tracks.forEach((track, index) => {
      const id = trackKey(track);
      if (!id || series.has(id)) return;
      series.set(id, {
        id,
        title: track?.title || track?.song_key || '曲名不明',
        points: [{ date, rank: ranks.get(id) ?? index + 1 }],
      });
    });
  }

  for (const item of series.values()) {
    const index = currentTracks?.findIndex((track) => trackKey(track) === item.id) ?? -1;
    item.currentRank = !currentTracks ? null : index < 0
      ? JAPAN_OUTSIDE_RANK
      : integer(currentTracks[index]?.rank) ?? index + 1;
    if (index >= 0 && currentTracks[index]?.title) item.title = currentTracks[index].title;
  }
  return [...series.values()];
}

function renderJapanLegend(series) {
  const container = element('appleRankLegend');
  if (!container) return;
  container.replaceChildren();
  for (const [index, item] of series.entries()) {
    const entry = document.createElement('span');
    entry.className = 'apple-rank-legend-item';
    const marker = document.createElement('i');
    marker.style.setProperty('--apple-rank-hue', String((index * 43) % 360));
    const label = document.createElement('span');
    label.textContent = `${rankLabel(item.currentRank)} ${item.title}`;
    entry.append(marker, label);
    container.append(entry);
  }
}

function renderRankChart(payload) {
  const container = element('appleRankChart');
  if (!container) return;
  const series = japanHistorySeries(payload);
  renderJapanLegend(series);
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  renderRankHistoryChart({
    container,
    series,
    dates,
    width: 960,
    height: 400,
    margin: { left: 52, right: 16, top: 16, bottom: 36 },
    yMax: JAPAN_OUTSIDE_RANK,
    rankTicks: [1, 3, 5, 10, JAPAN_RANK_LIMIT, JAPAN_OUTSIDE_RANK],
    dateTickCount: 3,
    ariaLabel: '人気曲順位。1位が上、圏外が下。',
    svgClass: 'apple-rank-svg',
    gridClass: 'apple-rank-grid',
    axisClass: 'apple-rank-axis-label',
    lineClass: 'apple-rank-line',
    emptyClass: 'apple-rank-empty',
    emptyText: '順位履歴はまだありません。',
    rankLabel,
    dateLabel: formatDate,
    hueVariable: '--apple-rank-hue',
    hueStep: 43,
    lineTitle: (item) => `${rankLabel(item.currentRank)} ${item.title}`,
  });
}

function regionalRows(payload) {
  const allRegions = orderedRegions(payload);
  const rows = new Map();

  for (const region of allRegions) {
    for (const track of (Array.isArray(region?.tracks) ? region.tracks : []).slice(0, 12)) {
      const id = trackKey(track);
      if (!id) continue;
      if (!rows.has(id)) {
        rows.set(id, {
          id,
          title: track?.title || '曲名不明',
          ranks: new Map(),
        });
      }
      const row = rows.get(id);
      if (!row.title || row.title === '曲名不明') row.title = track?.title || '曲名不明';
      row.ranks.set(region.code, integer(track?.rank));
    }
  }

  const values = [...rows.values()];
  const japanRanked = values
    .filter((row) => row.ranks.get('jp') != null)
    .sort((a, b) => a.ranks.get('jp') - b.ranks.get('jp'));
  const otherRanked = values
    .filter((row) => row.ranks.get('jp') == null)
    .sort((a, b) => {
      const aRanks = [...a.ranks.values()].filter((value) => value != null);
      const bRanks = [...b.ranks.values()].filter((value) => value != null);
      const aBest = Math.min(...aRanks, Number.POSITIVE_INFINITY);
      const bBest = Math.min(...bRanks, Number.POSITIVE_INFINITY);
      const aAverage = aRanks.length ? aRanks.reduce((sum, value) => sum + value, 0) / aRanks.length : Number.POSITIVE_INFINITY;
      const bAverage = bRanks.length ? bRanks.reduce((sum, value) => sum + value, 0) / bRanks.length : Number.POSITIVE_INFINITY;
      return aBest - bBest || aAverage - bAverage || a.title.localeCompare(b.title, 'ja');
    });

  return { allRegions, rows: [...japanRanked, ...otherRanked] };
}

function renderRegionComparison(payload) {
  const table = element('appleRegionCompareTable');
  if (!table) return;
  table.replaceChildren();
  const { allRegions, rows } = regionalRows(payload);

  const thead = document.createElement('thead');
  replaceTableHeader(thead, ['順位', '曲名', ...allRegions.map((region) => region.label || region.code.toUpperCase())]);
  const tbody = document.createElement('tbody');
  rows.forEach((item, index) => appendTableRow(tbody, [
    { text: index + 1, className: 'apple-list-rank' },
    { text: item.title, className: 'apple-song-title' },
    ...allRegions.map((region) => ({
      text: item.ranks.get(region.code) ?? '-',
      className: 'apple-rank-number',
    })),
  ]));
  table.append(thead, tbody);
}

function render(payload) {
  renderArtistState(payload);
  const selected = activePayload(payload);
  renderSummary(selected);
  renderRankChart(selected);
  renderRegionComparison(selected);
}

async function fetchPayload() {
  const response = await fetch('/api/apple-music', { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `Apple Music API HTTP ${response.status}`);
  return payload;
}

export async function loadAppleMusicView({ force = false } = {}) {
  if (!force && lastPayload) {
    render(lastPayload);
    loadPlaylistMemberships(false);
    return lastPayload;
  }
  if (!loadPromise || force) {
    loadPromise = fetchPayload().then((payload) => {
      lastPayload = payload;
      const selected = activePayload(payload);
      const failed = Array.isArray(selected?.failed_regions) ? selected.failed_regions : [];
      setNotice(failed.length ? `一部地域の取得に失敗しました：${failed.map((item) => item.label || item.code).join('、')}` : '');
      render(payload);
      loadPlaylistMemberships(force);
      return payload;
    }).catch((error) => {
      setNotice('Apple Musicデータの取得に失敗しました。', true);
      throw error;
    }).finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

globalThis.document?.querySelectorAll('[data-apple-artist]').forEach((button) => button.addEventListener('click', () => {
  selectedArtistKey = button.dataset.appleArtist || DEFAULT_ARTIST_KEY;
  if (lastPayload) {
    render(lastPayload);
    const selected = activePayload(lastPayload);
    const failed = Array.isArray(selected?.failed_regions) ? selected.failed_regions : [];
    setNotice(failed.length ? `一部地域の取得に失敗しました：${failed.map((item) => item.label || item.code).join('、')}` : '');
  }
}));