const START = '2026-09-10';
const nf = new Intl.NumberFormat('ja-JP');
const percent = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const state = { days: [], tracks: [], selected: -1, loaded: false };
const $ = (id) => document.getElementById(id);

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function identity(row) {
  if (row.spotify_id) return `spotify:${row.spotify_id}`;
  if (row.isrc) return `isrc:${row.isrc}`;
  if (row.stationhead_track_id != null) return `stationhead:${row.stationhead_track_id}`;
  const title = String(row.title || '曲名不明').normalize('NFKC').toLowerCase();
  const artist = String(row.artist || '').normalize('NFKC').toLowerCase();
  return `title:${title}\u0000${artist}`;
}

function label(row) {
  return String(row.title || row.spotify_id || row.isrc || row.stationhead_track_id || '曲名不明');
}

function color(index) {
  return `hsl(${Math.round((index * 137.508 + 332) % 360)} 100% 60%)`;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const data = await response.json();
  if (!response.ok || data?.ok !== true) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

function allocate(totalValue, rows) {
  const total = Math.max(0, Math.round(Number(totalValue) || 0));
  const totalPlays = rows.reduce((sum, row) => sum + row.play_count, 0);
  if (!totalPlays) return [];
  const result = rows.map((row) => {
    const exact = total * row.play_count / totalPlays;
    return {
      ...row,
      value: Math.floor(exact),
      fraction: exact % 1,
      share: row.play_count / totalPlays,
    };
  });
  let remainder = total - result.reduce((sum, row) => sum + row.value, 0);
  const order = [...result].sort((a, b) => b.fraction - a.fraction || b.play_count - a.play_count);
  for (let i = 0; remainder > 0 && order.length; i = (i + 1) % order.length) {
    order[i].value += 1;
    remainder -= 1;
  }
  return result.sort((a, b) => b.value - a.value || b.play_count - a.play_count);
}

function build(trackRows, dailyRows) {
  const playsByDay = new Map();
  for (const row of trackRows || []) {
    const day = String(row.play_date || '');
    const playCount = Math.max(0, Number(row.play_count) || 0);
    if (day < START || !playCount) continue;
    const key = identity(row);
    if (!playsByDay.has(day)) playsByDay.set(day, new Map());
    const map = playsByDay.get(day);
    const old = map.get(key);
    if (old) old.play_count += playCount;
    else map.set(key, {
      key,
      title: label(row),
      artist: String(row.artist || ''),
      play_count: playCount,
    });
  }

  const trackTotals = new Map();
  const days = [];
  for (const row of dailyRows || []) {
    const day = String(row.period_key || '');
    const total = num(row.stream_growth);
    const map = playsByDay.get(day);
    if (day < START || row.known_missing === true || total == null || total < 0 || !map?.size) continue;
    const sourceTracks = [...map.values()];
    const totalPlays = sourceTracks.reduce((sum, track) => sum + track.play_count, 0);
    if (!totalPlays) continue;
    const tracks = allocate(total, sourceTracks);
    for (const track of tracks) {
      const old = trackTotals.get(track.key) || { ...track, total: 0 };
      old.total += track.value;
      trackTotals.set(track.key, old);
    }
    days.push({ day, total: Math.round(total), totalPlays, tracks });
  }
  const tracks = [...trackTotals.values()].sort((a, b) => b.total - a.total);
  tracks.forEach((track, index) => { track.color = color(index); });
  return { days, tracks };
}

function renderLegend() {
  const node = $('playedTracksStreamLegend');
  if (!node) return;
  node.replaceChildren(...state.tracks.map((track) => {
    const item = document.createElement('span');
    item.className = 'played-tracks-stream-legend-item';
    const swatch = document.createElement('i');
    swatch.style.background = track.color;
    item.append(swatch, document.createTextNode(track.title));
    return item;
  }));
}

function renderDetail() {
  const node = $('playedTracksStreamDetail');
  const day = state.days[state.selected];
  if (!node || !day) return;
  const tracks = day.tracks
    .filter((track) => track.value > 0)
    .map((track) => `${track.title} ${nf.format(track.value)}（${nf.format(track.play_count)}回・${percent.format(track.share * 100)}%）`)
    .join(' / ');
  node.textContent = `${day.day}　総再生数 ${nf.format(day.total)}　再生履歴 ${nf.format(day.totalPlays)}回　${tracks}`;
}

function draw() {
  const canvas = $('playedTracksStreamChart');
  const scroller = $('playedTracksStreamScroller');
  if (!canvas || !scroller || !state.days.length || !scroller.clientWidth) return;
  const width = Math.max(scroller.clientWidth, 72 + state.days.length * 48);
  const height = 360;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const area = { left: 56, top: 18, right: 16, bottom: 44 };
  const plotW = width - area.left - area.right;
  const plotH = height - area.top - area.bottom;
  const maximum = Math.max(1, ...state.days.map((d) => d.total));
  const step = plotW / state.days.length;
  const barW = Math.max(10, Math.min(30, step * .7));
  const colors = new Map(state.tracks.map((t) => [t.key, t.color]));
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#667287';

  ctx.font = '10px system-ui';
  ctx.fillStyle = muted;
  ctx.strokeStyle = 'rgba(31,45,68,.12)';
  for (let i = 0; i <= 4; i += 1) {
    const y = area.top + plotH * i / 4;
    ctx.beginPath(); ctx.moveTo(area.left, y); ctx.lineTo(width - area.right, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(nf.format(Math.round(maximum * (1 - i / 4))), area.left - 7, y);
  }

  const positions = [];
  state.days.forEach((day, index) => {
    const x = area.left + step * (index + .5);
    positions.push(x);
    let bottom = area.top + plotH;
    for (const track of day.tracks) {
      if (!track.value) continue;
      const h = plotH * track.value / maximum;
      bottom -= h;
      ctx.fillStyle = colors.get(track.key) || '#888';
      ctx.fillRect(x - barW / 2, bottom, barW, Math.max(.7, h));
    }
    if (index === state.selected) {
      ctx.strokeStyle = 'rgba(31,45,68,.75)'; ctx.lineWidth = 2;
      ctx.strokeRect(x - barW / 2 - 2, area.top - 2, barW + 4, plotH + 4);
    }
  });

  ctx.fillStyle = muted; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const every = Math.max(1, Math.ceil(state.days.length / Math.max(2, Math.floor(plotW / 95))));
  state.days.forEach((day, index) => {
    if (index % every && index !== state.days.length - 1) return;
    const [, month, date] = day.day.split('-');
    ctx.fillText(`${Number(month)}/${Number(date)}`, positions[index], area.top + plotH + 9);
  });
  canvas.dataset.positions = JSON.stringify(positions);
}

export async function loadPlayedTrackStreamComposition() {
  if (state.loaded) { draw(); return; }
  const notice = $('playedTracksStreamNotice');
  try {
    const to = new Date().toISOString().slice(0, 10);
    const [trackHistory, daily] = await Promise.all([
      getJson(`/api/track-history?from=${START}&to=${to}&limit=20000&ranking=0`),
      getJson(`/api/history?mode=daily&from=${START}&to=${to}`),
    ]);
    if (trackHistory.truncated) throw new Error('track history response truncated');
    const model = build(trackHistory.rows, daily.rows);
    state.days = model.days;
    state.tracks = model.tracks;
    state.selected = state.days.length - 1;
    state.loaded = true;
    renderLegend(); renderDetail(); draw();
    if (notice) {
      notice.textContent = state.days.length ? '' : '推定に必要な日別総再生数または再生履歴がありません。';
      notice.hidden = Boolean(state.days.length);
    }
    requestAnimationFrame(() => { const s = $('playedTracksStreamScroller'); if (s) s.scrollLeft = s.scrollWidth; });
  } catch (error) {
    console.error('played track stream composition failed', error);
    if (notice) { notice.textContent = '曲別推定再生数の取得に失敗しました。'; notice.hidden = false; notice.classList.add('error'); }
  }
}

$('playedTracksStreamChart')?.addEventListener('pointerup', (event) => {
  const canvas = event.currentTarget;
  const positions = JSON.parse(canvas.dataset.positions || '[]');
  if (!positions.length) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (parseFloat(canvas.style.width) / rect.width);
  state.selected = positions.reduce((best, pos, index) => Math.abs(pos - x) < Math.abs(positions[best] - x) ? index : best, 0);
  renderDetail(); draw();
});

if ('ResizeObserver' in window) {
  const scroller = $('playedTracksStreamScroller');
  if (scroller) new ResizeObserver(() => { if (state.loaded) draw(); }).observe(scroller);
}
