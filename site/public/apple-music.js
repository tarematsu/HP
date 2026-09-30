import {
  appendEmptyState,
  byId as element,
  evenlySpacedIndexes,
  fullDate as formatFullDate,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate as formatDate,
  svgElement,
} from './dashboard-ui-common.js?v=20261001.1';

const REGION_ORDER = Object.freeze(['jp', 'tw', 'hk', 'kr', 'sg', 'th', 'us']);
const JAPAN_RANK_LIMIT = 12;
const JAPAN_OUTSIDE_RANK = JAPAN_RANK_LIMIT + 1;
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

function playlistModel(payload) {
  return payload?.playlist_model && typeof payload.playlist_model === 'object'
    ? payload.playlist_model
    : null;
}

function renderSummary(payload) {
  const count = element('appleRegionCount');
  const date = element('appleSnapshotDate');
  const playlistCount = element('applePlaylistCount');
  if (count) count.textContent = `${regions(payload).length}地域`;
  if (date) date.textContent = formatFullDate(payload?.snapshot_date);
  if (playlistCount) {
    const matched = integer(playlistModel(payload)?.coverage?.matched_playlists);
    playlistCount.textContent = matched == null ? '-' : `${matched}件`;
  }
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
  container.replaceChildren();
  const series = japanHistorySeries(payload);
  renderJapanLegend(series);
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  if (!series.length || !dates.length) {
    appendEmptyState(container, '順位履歴はまだありません。', { className: 'apple-rank-empty' });
    return;
  }

  const width = 960;
  const height = 400;
  const margin = { left: 52, right: 16, top: 16, bottom: 36 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xFor = (date) => {
    const index = dateIndex.get(date) ?? 0;
    return margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
  };
  const yFor = (rank) => margin.top + (rank - 1) / (JAPAN_OUTSIDE_RANK - 1) * plotHeight;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': '人気曲順位。1位が上、圏外が下。',
    class: 'apple-rank-svg',
  });

  const rankTicks = [1, 3, 5, 10, JAPAN_RANK_LIMIT, JAPAN_OUTSIDE_RANK];
  for (const rank of rankTicks) {
    const y = yFor(rank);
    svg.append(svgElement('line', {
      x1: margin.left,
      y1: y,
      x2: width - margin.right,
      y2: y,
      class: 'apple-rank-grid',
    }));
    svg.append(svgElement('text', {
      x: margin.left - 8,
      y: y + 4,
      'text-anchor': 'end',
      class: 'apple-rank-axis-label',
    }, rankLabel(rank)));
  }

  for (const index of evenlySpacedIndexes(dates.length, 3)) {
    svg.append(svgElement('text', {
      x: xFor(dates[index]),
      y: height - 9,
      'text-anchor': index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle',
      class: 'apple-rank-axis-label',
    }, formatDate(dates[index])));
  }

  series.forEach((item, index) => {
    let d = '';
    let previousIndex = null;
    for (const point of item.points) {
      if (!Number.isFinite(point.rank)) {
        previousIndex = null;
        continue;
      }
      const currentIndex = dateIndex.get(point.date);
      const command = previousIndex != null && currentIndex === previousIndex + 1 ? 'L' : 'M';
      d += ` ${command} ${xFor(point.date).toFixed(2)} ${yFor(point.rank).toFixed(2)}`;
      previousIndex = currentIndex;
    }
    const path = svgElement('path', { d: d.trim(), class: 'apple-rank-line' });
    path.style.setProperty('--apple-rank-hue', String((index * 43) % 360));
    path.append(svgElement('title', {}, `${rankLabel(item.currentRank)} ${item.title}`));
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

function safeAppleMusicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'music.apple.com' ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderPlaylistMemberships(payload) {
  const table = element('applePlaylistTable');
  if (!table) return;
  table.replaceChildren();

  const model = playlistModel(payload);
  const tracks = Array.isArray(model?.tracks) ? model.tracks : [];
  const thead = document.createElement('thead');
  const header = document.createElement('tr');
  for (const label of ['曲名', '掲載数', 'プレイリスト']) {
    const th = document.createElement('th');
    th.textContent = label;
    header.append(th);
  }
  thead.append(header);

  const tbody = document.createElement('tbody');
  if (!tracks.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = model ? '対象曲を含む公開プレイリストはまだ検出されていません。' : 'プレイリスト情報はまだありません。';
    row.append(cell);
    tbody.append(row);
  } else {
    tracks.forEach((track) => {
      const memberships = Array.isArray(track?.playlists) ? track.playlists : [];
      const row = document.createElement('tr');
      const title = document.createElement('td');
      title.textContent = track?.title || '曲名不明';
      title.className = 'apple-song-title';
      const count = document.createElement('td');
      count.textContent = String(memberships.length);
      count.className = 'apple-rank-number';
      const playlistCell = document.createElement('td');
      const links = document.createElement('div');
      links.className = 'apple-playlist-links';
      for (const membership of memberships) {
        const line = document.createElement('div');
        const url = safeAppleMusicUrl(membership?.url);
        if (url) {
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          anchor.textContent = membership?.name || membership?.id || 'プレイリスト';
          line.append(anchor);
        } else {
          line.textContent = membership?.name || membership?.id || 'プレイリスト';
        }
        const position = integer(membership?.position);
        if (position != null) line.append(document.createTextNode(`（${position}曲目）`));
        links.append(line);
      }
      playlistCell.append(links);
      row.append(title, count, playlistCell);
      tbody.append(row);
    });
  }
  table.append(thead, tbody);
}

function render(payload) {
  renderSummary(payload);
  renderRankChart(payload);
  renderRegionComparison(payload);
  renderPlaylistMemberships(payload);
}

async function fetchJson(path, label) {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `${label} HTTP ${response.status}`);
  return payload;
}

async function fetchPayload() {
  const main = await fetchJson('/api/apple-music', 'Apple Music API');
  let playlist = null;
  let playlistError = null;
  try {
    playlist = await fetchJson('/api/apple-music-playlists', 'Apple Music playlist API');
  } catch (error) {
    playlistError = error;
  }
  return {
    ...main,
    playlist_model: playlist,
    playlist_error: playlistError ? String(playlistError?.message || playlistError) : null,
  };
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
      const notices = [];
      if (failed.length) notices.push(`一部地域の取得に失敗しました：${failed.map((item) => item.label || item.code).join('、')}`);
      if (payload?.playlist_error) notices.push('プレイリスト情報の取得に失敗しました。');
      setNotice(notices.join(' '), Boolean(payload?.playlist_error));
      render(payload);
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