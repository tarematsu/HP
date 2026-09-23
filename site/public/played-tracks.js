const TARGET_DATE = '2026-09-22';
const integer = new Intl.NumberFormat('ja-JP');
const percent = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const state = {
  loading: false,
  loaded: false,
  rows: [],
  total: 0,
};

const byId = (id) => document.getElementById(id);

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function trackLabel(row) {
  const title = String(row?.title || row?.display_title || '').trim();
  if (title && title !== '曲情報なし') return title;
  return row?.spotify_id || row?.isrc || row?.stationhead_track_id || '曲名不明';
}

function normalizedRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.play_date || '') === TARGET_DATE)
    .map((row) => ({ ...row, play_count: finiteCount(row?.play_count) }))
    .filter((row) => row.play_count > 0)
    .sort((left, right) => right.play_count - left.play_count
      || trackLabel(left).localeCompare(trackLabel(right), 'ja'));
}

function colorFor(index) {
  const hue = Math.round((index * 137.508 + 332) % 360);
  return `hsl(${hue} 58% 52%)`;
}

function renderSummary() {
  const totalNode = byId('playedTracksTotal');
  const uniqueNode = byId('playedTracksUnique');
  if (totalNode) totalNode.textContent = integer.format(state.total);
  if (uniqueNode) uniqueNode.textContent = integer.format(state.rows.length);
}

function trackCell(row, index) {
  const cell = document.createElement('td');
  cell.className = 'track-name-cell';
  const wrap = document.createElement('div');
  wrap.className = 'played-tracks-track';
  const swatch = document.createElement('span');
  swatch.className = 'played-tracks-swatch';
  swatch.style.background = colorFor(index);
  swatch.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.style.minWidth = '0';
  const title = document.createElement('span');
  title.className = 'played-tracks-title';
  title.textContent = trackLabel(row);
  copy.append(title);
  const artistText = String(row?.artist || '').trim();
  if (artistText) {
    const artist = document.createElement('span');
    artist.className = 'played-tracks-artist';
    artist.textContent = artistText;
    copy.append(artist);
  }
  wrap.append(swatch, copy);
  cell.append(wrap);
  return cell;
}

function renderTable() {
  const tbody = byId('playedTracksTbody');
  if (!tbody) return;
  tbody.replaceChildren();

  const totalRow = document.createElement('tr');
  totalRow.className = 'played-tracks-total-row';
  const totalLabel = document.createElement('td');
  totalLabel.textContent = '総数';
  const totalCount = document.createElement('td');
  totalCount.className = 'played-tracks-number';
  totalCount.textContent = integer.format(state.total);
  const totalShare = document.createElement('td');
  totalShare.className = 'played-tracks-share';
  totalShare.textContent = state.total > 0 ? '100.0%' : '—';
  totalRow.append(totalLabel, totalCount, totalShare);
  tbody.append(totalRow);

  state.rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    const count = document.createElement('td');
    count.className = 'played-tracks-number';
    count.textContent = integer.format(row.play_count);
    const share = document.createElement('td');
    share.className = 'played-tracks-share';
    share.textContent = state.total > 0 ? `${percent.format(row.play_count / state.total * 100)}%` : '—';
    tr.append(trackCell(row, index), count, share);
    tbody.append(tr);
  });
}

function drawPie() {
  const canvas = byId('playedTracksChart');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  if (!state.total || !state.rows.length) {
    context.fillStyle = '#666';
    context.font = '14px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('再生曲データがありません', rect.width / 2, rect.height / 2);
    return;
  }

  const radius = Math.min(rect.width, rect.height) * 0.42;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  let angle = -Math.PI / 2;
  state.rows.forEach((row, index) => {
    const next = angle + Math.PI * 2 * row.play_count / state.total;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.arc(centerX, centerY, radius, angle, next);
    context.closePath();
    context.fillStyle = colorFor(index);
    context.fill();
    context.strokeStyle = '#fff';
    context.lineWidth = 1.5;
    context.stroke();
    angle = next;
  });
}

function render() {
  renderSummary();
  renderTable();
  drawPie();
}

function setNotice(message, error = false) {
  const notice = byId('playedTracksNotice');
  if (!notice) return;
  notice.textContent = message;
  notice.classList.toggle('error', error);
}

export async function loadPlayedTracks({ force = false } = {}) {
  if (state.loading || (state.loaded && !force)) return;
  state.loading = true;
  const button = byId('playedTracksLoad');
  if (button) button.disabled = true;
  setNotice('2026/9/22 の再生曲を読み込み中…');

  try {
    const url = `/api/track-history?from=${TARGET_DATE}&to=${TARGET_DATE}&limit=10000&ranking=0`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      cache: force ? 'reload' : 'default',
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || `track history API ${response.status}`);
    }
    state.rows = normalizedRows(payload.rows);
    state.total = state.rows.reduce((sum, row) => sum + row.play_count, 0);
    state.loaded = true;
    render();
    setNotice(state.total > 0
      ? `2026/9/22 のべ ${integer.format(state.total)} 曲を集計`
      : '2026/9/22 の再生曲データはありません。');
  } catch (error) {
    console.error('played tracks failed to load', error);
    setNotice('再生曲データの取得に失敗しました。', true);
  } finally {
    state.loading = false;
    if (button) button.disabled = false;
  }
}

byId('playedTracksLoad')?.addEventListener('click', () => loadPlayedTracks({ force: true }));

if ('ResizeObserver' in window) {
  const canvas = byId('playedTracksChart');
  if (canvas) new ResizeObserver(() => { if (state.loaded) drawPie(); }).observe(canvas);
} else {
  window.addEventListener('resize', () => { if (state.loaded) drawPie(); });
}

void loadPlayedTracks();

export { TARGET_DATE, normalizedRows };
