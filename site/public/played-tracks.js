const integer = new Intl.NumberFormat('ja-JP');
const percent = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const state = {
  loading: false,
  periodsLoaded: false,
  availableDates: [],
  selectedPeriod: '',
  weekMode: false,
  loadedRangeKey: '',
  rows: [],
  total: 0,
};

const byId = (id) => document.getElementById(id);

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parseDateKey(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = parseDateKey(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function startOfWeek(value) {
  const date = parseDateKey(value);
  if (!date) return '';
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return dateKey(date);
}

function shortDate(value) {
  const date = parseDateKey(value);
  if (!date) return '--/--';
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
}

function longDate(value) {
  const date = parseDateKey(value);
  if (!date) return value;
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function weekday(value) {
  const date = parseDateKey(value);
  return date ? WEEKDAYS[date.getUTCDay()] : '';
}

function trackLabel(row) {
  const title = String(row?.title || row?.display_title || '').trim();
  if (title && title !== '曲情報なし') return title;
  return row?.spotify_id || row?.isrc || row?.stationhead_track_id || '曲名不明';
}

function trackIdentity(row) {
  const spotify = String(row?.spotify_id || '').trim();
  if (spotify) return `spotify:${spotify}`;
  const isrc = String(row?.isrc || '').trim();
  if (isrc) return `isrc:${isrc}`;
  const title = trackLabel(row).normalize('NFKC').toLocaleLowerCase('ja');
  const artist = String(row?.artist || '').trim().normalize('NFKC').toLocaleLowerCase('ja');
  return `label:${title}\u0000${artist}`;
}

function normalizedRows(rows, from = '', to = '') {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const playDate = String(row?.play_date || '');
    if ((from && playDate < from) || (to && playDate > to)) continue;
    const count = finiteCount(row?.play_count);
    if (!count) continue;
    const key = trackIdentity(row);
    const existing = grouped.get(key);
    if (existing) {
      existing.play_count += count;
    } else {
      grouped.set(key, { ...row, play_count: count });
    }
  }
  return [...grouped.values()].sort((left, right) => right.play_count - left.play_count
    || trackLabel(left).localeCompare(trackLabel(right), 'ja'));
}

function colorFor(index) {
  const hue = Math.round((index * 137.508 + 332) % 360);
  return `hsl(${hue} 100% 60%)`;
}

function periodOptions() {
  if (!state.weekMode) return state.availableDates;
  return [...new Set(state.availableDates.map(startOfWeek).filter(Boolean))].sort();
}

function selectedRange() {
  if (!state.selectedPeriod) return { from: '', to: '' };
  return state.weekMode
    ? { from: state.selectedPeriod, to: addDays(state.selectedPeriod, 6) }
    : { from: state.selectedPeriod, to: state.selectedPeriod };
}

function selectedDescription() {
  const { from, to } = selectedRange();
  if (!from) return '';
  return state.weekMode ? `${longDate(from)}〜${longDate(to)}` : longDate(from);
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
  totalLabel.textContent = '総再生回数';
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
    context.fillText('再生履歴データがありません', rect.width / 2, rect.height / 2);
    return;
  }

  const radius = Math.min(rect.width, rect.height) * 0.32;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const topLabels = [];
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

    if (index < 5) {
      topLabels.push({
        row,
        index,
        midAngle: (angle + next) / 2,
      });
    }
    angle = next;
  });

  const labelRadius = radius * 1.24;
  const elbowRadius = radius * 1.08;
  const minLabelGap = 28;
  const labelMargin = 6;
  const labelFont = rect.width < 520 ? 11 : 12;
  const titleLimit = rect.width < 520 ? 14 : 22;
  const sides = [
    topLabels.filter(({ midAngle }) => Math.cos(midAngle) >= 0),
    topLabels.filter(({ midAngle }) => Math.cos(midAngle) < 0),
  ];

  for (const labels of sides) {
    labels.sort((left, right) => Math.sin(left.midAngle) - Math.sin(right.midAngle));
    let previousY = -Infinity;
    for (const label of labels) {
      const direction = Math.cos(label.midAngle) >= 0 ? 1 : -1;
      const edgeX = centerX + Math.cos(label.midAngle) * radius;
      const edgeY = centerY + Math.sin(label.midAngle) * radius;
      const elbowX = centerX + Math.cos(label.midAngle) * elbowRadius;
      const elbowY = centerY + Math.sin(label.midAngle) * elbowRadius;
      const desiredY = centerY + Math.sin(label.midAngle) * labelRadius;
      const minY = labelFont * 1.5;
      const maxY = rect.height - labelFont * 1.5;
      const labelY = Math.max(minY, Math.min(maxY, Math.max(desiredY, previousY + minLabelGap)));
      previousY = labelY;
      const lineEndX = direction > 0 ? rect.width - labelMargin : labelMargin;
      const textX = lineEndX + direction * 2;

      context.beginPath();
      context.moveTo(edgeX, edgeY);
      context.lineTo(elbowX, elbowY);
      context.lineTo(lineEndX, labelY);
      context.strokeStyle = colorFor(label.index);
      context.lineWidth = 1.5;
      context.stroke();

      const rawTitle = trackLabel(label.row);
      const title = rawTitle.length > titleLimit ? `${rawTitle.slice(0, titleLimit - 1)}…` : rawTitle;
      context.fillStyle = colorFor(label.index);
      context.textAlign = direction > 0 ? 'right' : 'left';
      context.textBaseline = 'bottom';
      context.font = `600 ${labelFont}px system-ui, sans-serif`;
      context.fillText(title, textX, labelY - 1);
      context.textBaseline = 'top';
      context.font = `700 ${labelFont}px system-ui, sans-serif`;
      context.fillText(integer.format(label.row.play_count), textX, labelY + 1);
    }
  }
}

function render() {
  renderSummary();
  renderTable();
  drawPie();
  const canvas = byId('playedTracksChart');
  if (canvas) canvas.setAttribute('aria-label', `${selectedDescription()} の曲別再生割合の円グラフ。上位5曲は曲名と再生数を表示`);
}

function setNotice(message, error = false) {
  const notice = byId('playedTracksNotice');
  if (!notice) return;
  notice.textContent = message;
  notice.classList.toggle('error', error);
  notice.hidden = !message;
}

function scrollSelectedPeriod({ smooth = false } = {}) {
  requestAnimationFrame(() => {
    const button = byId('playedTracksPeriodStrip')?.querySelector('.played-tracks-period.is-selected');
    button?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'nearest',
      inline: 'center',
    });
  });
}

function renderPeriodNavigator({ smooth = false, alignEnd = false } = {}) {
  const strip = byId('playedTracksPeriodStrip');
  if (!strip) return;
  strip.replaceChildren();
  for (const period of periodOptions()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'played-tracks-period';
    button.dataset.period = period;
    const selected = period === state.selectedPeriod;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', state.weekMode
      ? `${longDate(period)}からの週`
      : `${longDate(period)} ${weekday(period)}曜日`);

    const date = document.createElement('span');
    date.className = 'played-tracks-period-date';
    date.textContent = shortDate(period);
    const sub = document.createElement('span');
    sub.className = 'played-tracks-period-sub';
    sub.textContent = state.weekMode ? '(週)' : `(${weekday(period)})`;
    button.append(date, sub);
    strip.append(button);
  }

  if (alignEnd) {
    const scroller = byId('playedTracksPeriodScroller');
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    return;
  }
  scrollSelectedPeriod({ smooth });
}

async function fetchJson(url, { force = false } = {}) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    cache: force ? 'reload' : 'default',
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || `track history API ${response.status}`);
  }
  return payload;
}

async function loadPeriodIndex({ force = false } = {}) {
  if (state.periodsLoaded && !force) return;
  const payload = await fetchJson('/api/track-history?dates_only=1', { force });
  state.availableDates = (Array.isArray(payload.dates) ? payload.dates : [])
    .filter((value, index, values) => parseDateKey(value) && values.indexOf(value) === index)
    .sort();
  state.periodsLoaded = true;

  const options = periodOptions();
  if (!state.selectedPeriod || !options.includes(state.selectedPeriod)) {
    state.selectedPeriod = options.at(-1) || '';
  }
  renderPeriodNavigator({ alignEnd: true });
}

async function loadSelectedPeriod({ force = false } = {}) {
  const { from, to } = selectedRange();
  if (!from || !to) {
    state.rows = [];
    state.total = 0;
    state.loadedRangeKey = '';
    render();
    setNotice('再生履歴データがありません。');
    return;
  }
  const rangeKey = `${from}:${to}`;
  if (!force && state.loadedRangeKey === rangeKey) return;

  setNotice(`${selectedDescription()} の再生履歴を読み込み中…`);
  const payload = await fetchJson(`/api/track-history?from=${from}&to=${to}&limit=10000&ranking=0`, { force });
  state.rows = normalizedRows(payload.rows, from, to);
  state.total = state.rows.reduce((sum, row) => sum + row.play_count, 0);
  state.loadedRangeKey = rangeKey;
  render();
  setNotice(state.total > 0 ? '' : `${selectedDescription()} の再生履歴データはありません。`);
}

async function selectPeriod(period) {
  if (!period || period === state.selectedPeriod) return;
  state.selectedPeriod = period;
  renderPeriodNavigator({ smooth: true });
  await loadPlayedTracks();
}

function switchWeekMode(enabled) {
  if (state.weekMode === enabled) return;
  const previous = state.selectedPeriod;
  state.weekMode = enabled;
  const options = periodOptions();
  if (enabled) {
    const week = startOfWeek(previous || state.availableDates.at(-1));
    state.selectedPeriod = options.includes(week) ? week : options.at(-1) || '';
  } else {
    const weekStart = previous;
    const weekEnd = addDays(weekStart, 6);
    const withinWeek = state.availableDates.filter((date) => date >= weekStart && date <= weekEnd);
    state.selectedPeriod = withinWeek.at(-1) || state.availableDates.at(-1) || '';
  }
  state.loadedRangeKey = '';
  renderPeriodNavigator();
  void loadPlayedTracks();
}

export async function loadPlayedTracks({ force = false, refreshPeriods = false } = {}) {
  if (state.loading) return;
  state.loading = true;

  try {
    if (!state.periodsLoaded || refreshPeriods) {
      setNotice('再生履歴の日付一覧を読み込み中…');
      await loadPeriodIndex({ force: force || refreshPeriods });
    }
    await loadSelectedPeriod({ force });
  } catch (error) {
    console.error('played tracks failed to load', error);
    setNotice('再生履歴データの取得に失敗しました。', true);
  } finally {
    state.loading = false;
  }
}

byId('playedTracksWeekMode')?.addEventListener('change', (event) => switchWeekMode(Boolean(event.currentTarget.checked)));
byId('playedTracksPeriodStrip')?.addEventListener('click', (event) => {
  const button = event.target.closest('.played-tracks-period');
  if (!button) return;
  void selectPeriod(button.dataset.period);
});

if ('ResizeObserver' in window) {
  const canvas = byId('playedTracksChart');
  if (canvas) new ResizeObserver(() => { if (state.loadedRangeKey) drawPie(); }).observe(canvas);
} else {
  window.addEventListener('resize', () => { if (state.loadedRangeKey) drawPie(); });
}

void loadPlayedTracks();

export { normalizedRows, startOfWeek };
