import {
  byId as element,
  fullDate as formatFullDate,
  integerFormat as numberFormat,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate as formatDate,
  svgElement,
} from './dashboard-ui-common.js?v=20260930.1';

let loadPromise = null;
let lastPayload = null;

const setNotice = (message = '', error = false) => setSharedNotice('amazonMusicNotice', message, error);

function trackKey(track) {
  const amazonId = String(track?.amazon_music_id || '');
  if (amazonId) return `amazon:${amazonId}`;
  const trackId = integer(track?.track_id);
  return trackId != null && trackId > 0 ? `track:${trackId}` : '';
}

function trackTitleMap(payload) {
  return new Map((Array.isArray(payload?.tracks) ? payload.tracks : [])
    .map((track) => [trackKey(track), track?.label || track?.title || '曲名不明'])
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
  container.replaceChildren();

  const series = normalizeSeries(payload, metricKey);
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  const ranks = series.flatMap((item) => item.points.map((point) => point.rank));
  if (!series.length || !dates.length || !ranks.length) {
    const empty = document.createElement('p');
    empty.className = 'amazon-rank-empty';
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  const width = 960;
  const height = 420;
  const margin = { left: 58, right: 18, top: 18, bottom: 38 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxRank = Math.max(1, ...ranks);
  const yMax = Math.max(5, Math.ceil(maxRank / 5) * 5);
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xFor = (date) => {
    const index = dateIndex.get(date) ?? 0;
    return margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
  };
  const yFor = (rank) => margin.top + (rank - 1) / Math.max(1, yMax - 1) * plotHeight;

  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': ariaLabel,
    class: 'amazon-rank-svg',
  });

  const rankTicks = [...new Set([1, ...[0.25, 0.5, 0.75, 1]
    .map((ratio) => Math.max(1, Math.round(yMax * ratio)))])].sort((a, b) => a - b);
  for (const rank of rankTicks) {
    const y = yFor(rank);
    svg.append(svgElement('line', {
      x1: margin.left,
      y1: y,
      x2: width - margin.right,
      y2: y,
      class: 'amazon-rank-grid',
    }));
    const label = svgElement('text', {
      x: margin.left - 8,
      y: y + 4,
      'text-anchor': 'end',
      class: 'amazon-rank-axis-label',
    });
    label.textContent = `${rank}位`;
    svg.append(label);
  }

  const dateTicks = [...new Set(dates.length <= 1
    ? [0]
    : [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round((dates.length - 1) * ratio)))];
  for (const index of dateTicks) {
    const label = svgElement('text', {
      x: xFor(dates[index]),
      y: height - 10,
      'text-anchor': index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle',
      class: 'amazon-rank-axis-label',
    });
    label.textContent = formatDate(dates[index]);
    svg.append(label);
  }

  series.forEach((item, index) => {
    let d = '';
    let previousIndex = null;
    for (const point of item.points) {
      const currentIndex = dateIndex.get(point.date);
      const x = xFor(point.date);
      const y = yFor(point.rank);
      const continues = previousIndex != null && currentIndex === previousIndex + 1;
      d += `${continues ? ' L' : ' M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      previousIndex = currentIndex;
    }
    if (d) {
      const path = svgElement('path', {
        d: d.trim(),
        class: 'amazon-rank-line',
      });
      path.style.setProperty('--amazon-rank-hue', String((index * 47) % 360));
      const title = svgElement('title');
      title.textContent = `${item.title}${item.currentRank == null ? '' : ` 現在${item.currentRank}位`}`;
      path.append(title);
      svg.append(path);
    }
    const latest = item.points.at(-1);
    if (latest) {
      const circle = svgElement('circle', {
        cx: xFor(latest.date),
        cy: yFor(latest.rank),
        r: item.currentRank != null ? 2.5 : 1.8,
        class: 'amazon-rank-point',
      });
      circle.style.setProperty('--amazon-rank-hue', String((index * 47) % 360));
      const title = svgElement('title');
      title.textContent = `${item.title} ${formatFullDate(latest.date)} ${latest.rank}位`;
      circle.append(title);
      svg.append(circle);
    }
  });

  container.append(svg);
}

function renderSummary(payload) {
  const date = element('amazonSnapshotDate');
  if (date) date.textContent = formatFullDate(payload?.snapshot_date);
}

function renderTable(payload) {
  const tbody = element('amazonMusicTbody');
  if (!tbody) return;
  tbody.replaceChildren();
  const tracks = [...(Array.isArray(payload?.tracks) ? payload.tracks : [])]
    .sort((a, b) => (integer(a?.amazon_rank) ?? Number.MAX_SAFE_INTEGER)
      - (integer(b?.amazon_rank) ?? Number.MAX_SAFE_INTEGER));
  for (const track of tracks) {
    const row = document.createElement('tr');
    const amazonRank = document.createElement('td');
    const title = document.createElement('td');
    const amazon = integer(track?.amazon_rank);
    amazonRank.textContent = amazon == null ? '-' : `${numberFormat.format(amazon)}位`;
    title.textContent = track?.label || track?.title || '曲名不明';
    amazonRank.className = 'amazon-rank-number';
    row.append(amazonRank, title);
    tbody.append(row);
  }
}

function render(payload) {
  renderSummary(payload);
  renderRankChart(payload, {
    containerId: 'amazonAllRankChart',
    metricKey: 'amazon_rank',
    emptyText: 'Amazon Music総合順位の履歴はまだありません。',
    ariaLabel: '櫻坂46全楽曲のAmazon Music総合順位推移。1位が上。',
  });
  renderTable(payload);
}

async function fetchPayload() {
  const response = await fetch('/api/amazon-music', {
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Amazon Music API HTTP ${response.status}`);
  }
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
    }).finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}
