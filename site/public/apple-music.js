import {
  byId as element,
  fullDate as formatFullDate,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate as formatDate,
  svgElement,
} from './dashboard-ui-common.js?v=20260930.1';

const REGION_ORDER = Object.freeze(['jp', 'tw', 'hk', 'kr', 'sg', 'th', 'us']);
let loadPromise = null;
let lastPayload = null;

function trackKey(track) {
  const trackId = integer(track?.track_id);
  if (trackId != null) return `track:${trackId}`;
  return String(track?.song_key || track?.apple_music_id || '');
}

const setNotice = (message = '', error = false) => setSharedNotice('appleMusicNotice', message, error);

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

function renderSummary(payload) {
  const count = element('appleRegionCount');
  const date = element('appleSnapshotDate');
  if (count) count.textContent = `${regions(payload).length}地域`;
  if (date) date.textContent = formatFullDate(payload?.snapshot_date);
}

function japanHistorySeries(payload) {
  const japan = regionByCode(payload, 'jp');
  const currentTracks = (Array.isArray(japan?.tracks) ? japan.tracks : []).slice(0, 12);
  const titleById = new Map(currentTracks
    .map((track) => [trackKey(track), track.title || '曲名不明'])
    .filter(([key]) => key));
  const byId = new Map([...titleById.keys()].map((id) => [id, []]));

  for (const point of Array.isArray(payload?.history) ? payload.history : []) {
    const date = String(point?.snapshot_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const track of Array.isArray(point?.regions?.jp) ? point.regions.jp : []) {
      const id = trackKey(track);
      const rank = integer(track?.rank);
      if (!byId.has(id) || rank == null || rank < 1) continue;
      byId.get(id).push({ date, rank });
    }
  }

  return currentTracks.map((track, index) => ({
    id: trackKey(track),
    title: track.title || '曲名不明',
    currentRank: integer(track.rank) ?? index + 1,
    points: (byId.get(trackKey(track)) || []).sort((a, b) => a.date.localeCompare(b.date)),
  })).filter((series) => series.id && series.points.length);
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
    label.textContent = `${item.currentRank}位 ${item.title}`;
    entry.append(marker, label);
    container.append(entry);
  }
}

function renderRankChart(payload) {
  const container = element('appleRankChart');
  if (!container) return;
  container.replaceChildren();
  const series = japanHistorySeries(payload);
  renderJapanLegend(series);
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  if (!series.length || !dates.length) {
    const empty = document.createElement('p');
    empty.className = 'apple-rank-empty';
    empty.textContent = '日本の順位履歴はまだありません。';
    container.append(empty);
    return;
  }

  const width = 960;
  const height = 400;
  const margin = { left: 52, right: 16, top: 16, bottom: 36 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxRank = Math.max(12, ...series.flatMap((item) => item.points.map((point) => point.rank)));
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xFor = (date) => {
    const index = dateIndex.get(date) ?? 0;
    return margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
  };
  const yFor = (rank) => margin.top + (rank - 1) / Math.max(1, maxRank - 1) * plotHeight;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': '日本のApple Music櫻坂46人気曲順位推移。1位が上。',
    class: 'apple-rank-svg',
  });

  const rankTicks = [...new Set([1, 3, 5, 10, maxRank].filter((rank) => rank <= maxRank))];
  for (const rank of rankTicks) {
    const y = yFor(rank);
    svg.append(svgElement('line', {
      x1: margin.left,
      y1: y,
      x2: width - margin.right,
      y2: y,
      class: 'apple-rank-grid',
    }));
    const label = svgElement('text', {
      x: margin.left - 8,
      y: y + 4,
      'text-anchor': 'end',
      class: 'apple-rank-axis-label',
    });
    label.textContent = `${rank}位`;
    svg.append(label);
  }

  const dateTicks = [...new Set(dates.length <= 1
    ? [0]
    : [0, 0.5, 1].map((ratio) => Math.round((dates.length - 1) * ratio)))];
  for (const index of dateTicks) {
    const label = svgElement('text', {
      x: xFor(dates[index]),
      y: height - 9,
      'text-anchor': index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle',
      class: 'apple-rank-axis-label',
    });
    label.textContent = formatDate(dates[index]);
    svg.append(label);
  }

  series.forEach((item, index) => {
    let d = '';
    let previousIndex = null;
    for (const point of item.points) {
      const currentIndex = dateIndex.get(point.date);
      const command = previousIndex != null && currentIndex === previousIndex + 1 ? 'L' : 'M';
      d += ` ${command} ${xFor(point.date).toFixed(2)} ${yFor(point.rank).toFixed(2)}`;
      previousIndex = currentIndex;
    }
    const path = svgElement('path', { d: d.trim(), class: 'apple-rank-line' });
    path.style.setProperty('--apple-rank-hue', String((index * 43) % 360));
    const title = svgElement('title');
    title.textContent = `${item.currentRank}位 ${item.title}`;
    path.append(title);
    svg.append(path);
  });
  container.append(svg);
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
  const header = document.createElement('tr');
  const rankHeader = document.createElement('th');
  rankHeader.textContent = '順位';
  const songHeader = document.createElement('th');
  songHeader.textContent = '曲名';
  header.append(rankHeader, songHeader);
  for (const region of allRegions) {
    const th = document.createElement('th');
    th.textContent = region.label || region.code.toUpperCase();
    header.append(th);
  }
  thead.append(header);

  const tbody = document.createElement('tbody');
  rows.forEach((item, index) => {
    const row = document.createElement('tr');
    const order = document.createElement('td');
    order.textContent = String(index + 1);
    order.className = 'apple-list-rank';
    const title = document.createElement('td');
    title.textContent = item.title;
    title.className = 'apple-song-title';
    row.append(order, title);
    for (const region of allRegions) {
      const cell = document.createElement('td');
      const rank = item.ranks.get(region.code);
      cell.textContent = rank == null ? '-' : String(rank);
      cell.className = 'apple-rank-number';
      row.append(cell);
    }
    tbody.append(row);
  });
  table.append(thead, tbody);
}

function render(payload) {
  renderSummary(payload);
  renderRankChart(payload);
  renderRegionComparison(payload);
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
    return lastPayload;
  }
  if (!loadPromise || force) {
    loadPromise = fetchPayload().then((payload) => {
      lastPayload = payload;
      const failed = Array.isArray(payload?.failed_regions) ? payload.failed_regions : [];
      setNotice(failed.length ? `一部地域の取得に失敗しました: ${failed.map((item) => item.label || item.code).join('、')}` : '');
      render(payload);
      return payload;
    }).catch((error) => {
      setNotice('Apple Musicデータを取得できませんでした。', true);
      throw error;
    }).finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}
