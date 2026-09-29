const SVG_NS = 'http://www.w3.org/2000/svg';
let loadPromise = null;
let lastPayload = null;
let selectedRegion = 'jp';

function element(id) {
  return document.getElementById(id);
}

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function trackKey(track) {
  return String(track?.song_key || track?.track_id || '');
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '-');
  return `${Number(match[2])}/${Number(match[3])}`;
}

function formatFullDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '-');
  return `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}`;
}

function setNotice(message = '', error = false) {
  const notice = element('appleMusicNotice');
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle('error', Boolean(error));
}

function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function regions(payload) {
  return Array.isArray(payload?.regions) ? payload.regions : [];
}

function regionByCode(payload, code) {
  return regions(payload).find((region) => region?.code === code) || regions(payload)[0] || null;
}

function previousHistoryPoint(payload) {
  const history = [...(Array.isArray(payload?.history) ? payload.history : [])]
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(String(point?.snapshot_date || '')))
    .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
  const currentIndex = history.findIndex((point) => point.snapshot_date === payload?.snapshot_date);
  if (currentIndex > 0) return history[currentIndex - 1];
  if (currentIndex === -1 && history.length > 1) return history.at(-2);
  return null;
}

function previousRankMap(payload, code) {
  const point = previousHistoryPoint(payload);
  return new Map((Array.isArray(point?.regions?.[code]) ? point.regions[code] : [])
    .map((track) => [trackKey(track), integer(track?.rank)])
    .filter(([key]) => key));
}

function rankChangeLabel(currentRank, previousRank) {
  if (previousRank == null) return 'NEW';
  const delta = previousRank - currentRank;
  if (delta > 0) return `↑${delta}`;
  if (delta < 0) return `↓${Math.abs(delta)}`;
  return '→';
}

function renderSummary(payload) {
  const count = element('appleRegionCount');
  const date = element('appleSnapshotDate');
  if (count) count.textContent = `${regions(payload).length}地域`;
  if (date) date.textContent = formatFullDate(payload?.snapshot_date);
}

function renderRegionTabs(payload) {
  const container = element('appleRegionTabs');
  if (!container) return;
  container.replaceChildren();
  for (const region of regions(payload)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.region = region.code;
    button.textContent = region.label || String(region.code || '').toUpperCase();
    button.classList.toggle('active', region.code === selectedRegion);
    button.setAttribute('aria-pressed', region.code === selectedRegion ? 'true' : 'false');
    button.addEventListener('click', () => {
      selectedRegion = region.code;
      render(lastPayload || payload);
    });
    container.append(button);
  }
}

function renderCurrentTable(payload) {
  const tbody = element('appleMusicTbody');
  if (!tbody) return;
  tbody.replaceChildren();
  const region = regionByCode(payload, selectedRegion);
  if (!region) return;
  const previous = previousRankMap(payload, region.code);
  for (const track of Array.isArray(region.tracks) ? region.tracks : []) {
    const row = document.createElement('tr');
    const rank = document.createElement('td');
    const title = document.createElement('td');
    const change = document.createElement('td');
    const currentRank = integer(track?.rank);
    const previousRank = previous.get(trackKey(track)) ?? null;
    rank.textContent = currentRank == null ? '-' : `${currentRank}位`;
    title.textContent = String(track?.title || '曲名不明');
    change.textContent = currentRank == null ? '-' : rankChangeLabel(currentRank, previousRank);
    rank.className = 'apple-rank-number';
    change.className = 'apple-rank-change';
    if (previousRank != null && currentRank != null) {
      change.classList.toggle('positive', previousRank > currentRank);
      change.classList.toggle('negative', previousRank < currentRank);
    }
    row.append(rank, title, change);
    tbody.append(row);
  }
}

function historySeries(payload, region) {
  const currentTracks = (Array.isArray(region?.tracks) ? region.tracks : []).slice(0, 12);
  const titleById = new Map(currentTracks.map((track) => [trackKey(track), track.title || '曲名不明']).filter(([key]) => key));
  const byId = new Map([...titleById.keys()].map((id) => [id, []]));
  for (const point of Array.isArray(payload?.history) ? payload.history : []) {
    const date = String(point?.snapshot_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const track of Array.isArray(point?.regions?.[region.code]) ? point.regions[region.code] : []) {
      const id = trackKey(track);
      const rank = integer(track?.rank);
      if (!byId.has(id) || rank == null || rank < 1) continue;
      byId.get(id).push({ date, rank });
    }
  }
  return [...byId.entries()].map(([id, points]) => ({
    id,
    title: titleById.get(id) || id,
    points: points.sort((a, b) => a.date.localeCompare(b.date)),
  })).filter((series) => series.points.length);
}

function renderRankChart(payload) {
  const container = element('appleRankChart');
  if (!container) return;
  container.replaceChildren();
  const region = regionByCode(payload, selectedRegion);
  const series = historySeries(payload, region);
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  if (!series.length || !dates.length) {
    const empty = document.createElement('p');
    empty.className = 'apple-rank-empty';
    empty.textContent = '順位履歴はまだありません。';
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
    'aria-label': `${region?.label || selectedRegion}のApple Music櫻坂46人気曲順位推移。1位が上。`,
    class: 'apple-rank-svg',
  });

  const rankTicks = [...new Set([1, 3, 5, 10, maxRank].filter((rank) => rank <= maxRank))];
  for (const rank of rankTicks) {
    const y = yFor(rank);
    svg.append(svgElement('line', { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: 'apple-rank-grid' }));
    const label = svgElement('text', { x: margin.left - 8, y: y + 4, 'text-anchor': 'end', class: 'apple-rank-axis-label' });
    label.textContent = `${rank}位`;
    svg.append(label);
  }

  const dateTicks = [...new Set(dates.length <= 1 ? [0] : [0, 0.5, 1].map((ratio) => Math.round((dates.length - 1) * ratio)))];
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
    title.textContent = item.title;
    path.append(title);
    svg.append(path);
  });
  container.append(svg);
}

function renderRegionComparison(payload) {
  const table = element('appleRegionCompareTable');
  if (!table) return;
  table.replaceChildren();
  const allRegions = regions(payload);
  const titleById = new Map();
  const ranksById = new Map();
  for (const region of allRegions) {
    for (const track of (Array.isArray(region?.tracks) ? region.tracks : []).slice(0, 12)) {
      const id = trackKey(track);
      if (!id) continue;
      titleById.set(id, track?.title || '曲名不明');
      if (!ranksById.has(id)) ranksById.set(id, new Map());
      ranksById.get(id).set(region.code, integer(track?.rank));
    }
  }
  const ids = [...ranksById.keys()].sort((a, b) => {
    const aRanks = ranksById.get(a);
    const bRanks = ranksById.get(b);
    const aFallback = Math.min(...[...aRanks.values()].filter((value) => value != null), Number.POSITIVE_INFINITY);
    const bFallback = Math.min(...[...bRanks.values()].filter((value) => value != null), Number.POSITIVE_INFINITY);
    const aJp = aRanks.get('jp') ?? aFallback;
    const bJp = bRanks.get('jp') ?? bFallback;
    return aJp - bJp || String(titleById.get(a)).localeCompare(String(titleById.get(b)), 'ja');
  });

  const thead = document.createElement('thead');
  const header = document.createElement('tr');
  const songHeader = document.createElement('th');
  songHeader.textContent = '曲名';
  header.append(songHeader);
  for (const region of allRegions) {
    const th = document.createElement('th');
    th.textContent = region.label || region.code.toUpperCase();
    header.append(th);
  }
  thead.append(header);

  const tbody = document.createElement('tbody');
  for (const id of ids) {
    const row = document.createElement('tr');
    const title = document.createElement('td');
    title.textContent = titleById.get(id) || '曲名不明';
    row.append(title);
    for (const region of allRegions) {
      const cell = document.createElement('td');
      const rank = ranksById.get(id)?.get(region.code);
      cell.textContent = rank == null ? '-' : `${rank}`;
      cell.className = 'apple-rank-number';
      row.append(cell);
    }
    tbody.append(row);
  }
  table.append(thead, tbody);
}

function render(payload) {
  if (!regions(payload).some((region) => region.code === selectedRegion)) {
    selectedRegion = regions(payload)[0]?.code || 'jp';
  }
  renderSummary(payload);
  renderRegionTabs(payload);
  renderRankChart(payload);
  renderCurrentTable(payload);
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
