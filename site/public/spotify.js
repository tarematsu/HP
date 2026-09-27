const ARTISTS = Object.freeze({
  nogizaka46: '乃木坂46',
  sakurazaka46: '櫻坂46',
  hinatazaka46: '日向坂46',
});
const TREND_COLORS = Object.freeze([
  '#f3a6c8', '#8264b0', '#9ecff3', '#ef8a62', '#67a9cf',
  '#a6d854', '#ffd92f', '#e78ac3', '#8da0cb', '#fc8d62',
  '#66c2a5', '#e5c494', '#b3b3b3', '#1b9e77', '#d95f02',
  '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d',
]);
const SVG_NS = 'http://www.w3.org/2000/svg';

const DEFAULT_ARTIST = 'sakurazaka46';
const numberFormat = new Intl.NumberFormat('ja-JP');
const compactNumberFormat = new Intl.NumberFormat('ja-JP', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
let activeArtist = DEFAULT_ARTIST;
let requestSequence = 0;
let readModelPromise = null;

function element(id) {
  return document.getElementById(id);
}

function setNotice(message = '', error = false) {
  const notice = element('spotifyNotice');
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle('error', Boolean(error));
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '-';
  return `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}`;
}

function formatTrendDate(value) {
  const match = String(value || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  return `${Number(match[1])}/${Number(match[2])}`;
}

function deltaNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function formatDelta(value) {
  const number = deltaNumber(value);
  if (number == null) return '-';
  return number > 0 ? `+${numberFormat.format(number)}` : numberFormat.format(number);
}

function updateArtistButtons() {
  document.querySelectorAll('[data-spotify-artist]').forEach((button) => {
    const selected = button.dataset.spotifyArtist === activeArtist;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

function renderRows(payload) {
  const body = element('spotifyTbody');
  if (!body) return;
  body.replaceChildren();

  for (const track of payload.tracks || []) {
    const row = document.createElement('tr');
    const rank = document.createElement('td');
    const name = document.createElement('td');
    const playcount = document.createElement('td');
    const delta = document.createElement('td');
    rank.textContent = numberFormat.format(Number(track.rank) || 0);
    name.textContent = String(track.name || '曲名不明');
    playcount.textContent = numberFormat.format(Number(track.playcount) || 0);
    delta.textContent = formatDelta(track.delta);
    playcount.className = 'spotify-number';
    delta.className = 'spotify-number';
    row.append(rank, name, playcount, delta);
    body.append(row);
  }
}

function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function normalizeTrendSeries(trend = {}) {
  return Object.entries(trend || {}).map(([artistKey, rawPoints]) => {
    const points = (Array.isArray(rawPoints) ? [...rawPoints] : [])
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(String(point?.snapshot_date || '')))
      .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
    const metadata = points.find((point) => point?.artist_name || point?.current_rank != null) || {};
    return {
      artistKey,
      artistName: String(metadata.artist_name || ARTISTS[artistKey] || artistKey),
      currentRank: deltaNumber(metadata.current_rank),
      points,
    };
  }).filter((series) => series.points.length)
    .sort((a, b) => {
      const aRank = a.currentRank ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.currentRank ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.artistName.localeCompare(b.artistName, 'ja');
    });
}

function renderTrendCharts(trend = {}) {
  const container = element('spotifyTrendCharts');
  if (!container) return;
  container.replaceChildren();

  const seriesList = normalizeTrendSeries(trend);
  const dates = [...new Set(
    seriesList.flatMap((series) => series.points.map((point) => String(point.snapshot_date))),
  )].sort();

  if (!dates.length) {
    const empty = document.createElement('p');
    empty.className = 'spotify-trend-empty';
    empty.textContent = 'Spotify再生数の推移データはまだありません。';
    container.append(empty);
    return;
  }

  const values = seriesList
    .flatMap((series) => series.points.map((point) => deltaNumber(point?.total_delta)))
    .filter((value) => value != null);
  let yMin = Math.min(0, ...values);
  let yMax = Math.max(0, ...values);
  if (yMin === yMax) yMax = yMin + 1;
  if (yMin < 0) yMin = Math.floor(yMin * 1.08);
  if (yMax > 0) yMax = Math.ceil(yMax * 1.08);
  const yRange = Math.max(1, yMax - yMin);

  const width = 720;
  const height = 190;
  const margin = { left: 64, right: 18, top: 14, bottom: 34 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xForIndex = (index) => margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
  const yForValue = (value) => margin.top + (yMax - value) / yRange * plotHeight;
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xTicks = [...new Set(dates.length <= 1
    ? [0]
    : [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round((dates.length - 1) * ratio)))];

  seriesList.forEach(({ artistKey, artistName, currentRank, points }, seriesIndex) => {
    const byDate = new Map(points.map((point) => [String(point.snapshot_date), point]));
    const latest = [...points].reverse().find((point) => deltaNumber(point?.total_delta) != null);

    const series = document.createElement('section');
    series.className = 'spotify-trend-series';
    series.dataset.artist = artistKey;
    series.style.setProperty('--spotify-trend-color', TREND_COLORS[seriesIndex % TREND_COLORS.length]);

    const head = document.createElement('div');
    head.className = 'spotify-trend-head';
    const name = document.createElement('span');
    name.className = 'spotify-trend-name';
    name.textContent = currentRank == null ? artistName : `${currentRank}位 ${artistName}`;
    const latestValue = document.createElement('strong');
    latestValue.className = 'spotify-trend-latest';
    latestValue.textContent = formatDelta(latest?.total_delta);
    head.append(name, latestValue);

    const scroll = document.createElement('div');
    scroll.className = 'spotify-trend-scroll';
    const svg = svgElement('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `${artistName} Spotify前回比合計の推移`,
      class: 'spotify-trend-svg',
    });

    for (let tick = 0; tick <= 3; tick += 1) {
      const value = yMax - yRange * tick / 3;
      const y = yForValue(value);
      const grid = svgElement('line', {
        x1: margin.left,
        y1: y,
        x2: width - margin.right,
        y2: y,
        class: 'spotify-trend-grid',
      });
      const label = svgElement('text', {
        x: margin.left - 8,
        y: y + 4,
        'text-anchor': 'end',
        class: 'spotify-trend-axis-label',
      });
      label.textContent = compactNumberFormat.format(Math.round(value));
      svg.append(grid, label);
    }

    if (yMin < 0 && yMax > 0) {
      const zeroY = yForValue(0);
      svg.append(svgElement('line', {
        x1: margin.left,
        y1: zeroY,
        x2: width - margin.right,
        y2: zeroY,
        class: 'spotify-trend-axis',
      }));
    }

    for (const index of xTicks) {
      const x = xForIndex(index);
      const label = svgElement('text', {
        x,
        y: height - 10,
        'text-anchor': index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle',
        class: 'spotify-trend-axis-label',
      });
      label.textContent = formatTrendDate(dates[index]);
      svg.append(label);
    }

    let pathData = '';
    let drawing = false;
    for (const date of dates) {
      const point = byDate.get(date);
      const value = deltaNumber(point?.total_delta);
      if (value == null) {
        drawing = false;
        continue;
      }
      const x = xForIndex(dateIndex.get(date));
      const y = yForValue(value);
      pathData += `${drawing ? ' L' : ' M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      drawing = true;
    }
    if (pathData) {
      svg.append(svgElement('path', {
        d: pathData.trim(),
        class: 'spotify-trend-line',
      }));
    }

    for (const point of points) {
      const value = deltaNumber(point?.total_delta);
      if (value == null) continue;
      const index = dateIndex.get(String(point.snapshot_date));
      if (index == null) continue;
      const circle = svgElement('circle', {
        cx: xForIndex(index),
        cy: yForValue(value),
        r: 3.5,
        class: 'spotify-trend-point',
      });
      const title = svgElement('title');
      title.textContent = `${formatDate(point.snapshot_date)} ${formatDelta(value)}`;
      circle.append(title);
      svg.append(circle);
    }

    scroll.append(svg);
    series.append(head, scroll);
    container.append(series);
  });
}

function render(payload, trend) {
  const artistName = payload?.artist?.name || ARTISTS[activeArtist];
  const title = element('spotifyTableTitle');
  if (title) title.textContent = `${artistName} 再生数一覧`;
  const date = element('spotifySnapshotDate');
  if (date) date.textContent = formatDate(payload?.snapshot_date);
  const count = element('spotifyTrackCount');
  if (count) count.textContent = numberFormat.format(Number(payload?.track_count) || 0);
  const delta = element('spotifyTotalDelta');
  if (delta) delta.textContent = formatDelta(payload?.total_delta);
  renderTrendCharts(trend);
  renderRows(payload || {});

  if (!payload?.track_count) {
    setNotice(`${artistName}のSpotify再生数はまだ収集されていません。`);
  } else if (payload.carried_forward) {
    setNotice(`${formatDate(payload.snapshot_date)} はSpotify公開値の更新が確認できなかったため、直近の累計値を引き継いでいます。`);
  } else {
    setNotice('');
  }
}

async function fetchReadModel({ refresh = false } = {}) {
  if (refresh) readModelPromise = null;
  if (!readModelPromise) {
    readModelPromise = fetch('/api/spotify-playcounts')
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        return payload;
      })
      .catch((error) => {
        readModelPromise = null;
        throw error;
      });
  }
  return readModelPromise;
}

export async function loadSpotifyView({ artist = activeArtist, refresh = false } = {}) {
  const requested = ARTISTS[artist] ? artist : DEFAULT_ARTIST;
  const sequence = ++requestSequence;
  activeArtist = requested;
  updateArtistButtons();
  try {
    setNotice('');
    const model = await fetchReadModel({ refresh });
    if (sequence !== requestSequence || activeArtist !== requested) return;
    const payload = model?.groups?.[requested];
    if (!payload) throw new Error(`${ARTISTS[requested]}のリードモデルがありません`);
    render(payload, model?.trend || {});
  } catch (error) {
    if (sequence !== requestSequence || activeArtist !== requested) return;
    setNotice(`Spotify再生数の取得に失敗しました: ${error.message}`, true);
  }
}

document.getElementById('spotifyView')?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-spotify-artist]');
  if (!button) return;
  const artist = button.dataset.spotifyArtist;
  if (!ARTISTS[artist] || artist === activeArtist) return;
  void loadSpotifyView({ artist });
});
