import { loadSpotifyReadModel } from './dashboard-data-client.js?v=20261005.2';
import {
  byId as element,
  fullDate as formatDate,
  integerFormat as numberFormat,
  setNotice as setSharedNotice,
  signedInteger,
} from './dashboard-ui-common.js?v=20260930.1';
import { observeDashboardChartResize } from './dashboard-chart-runtime.js?v=20261001.1';
import { spotifyAllTracksPayload } from './spotify-all-tracks.js?v=20261004.1';
import { renderTrendChart, normalizeTrendSeries, graphTrendSeries } from './spotify-trend-chart.js';
import { appendTableRow } from './dashboard-table-dom.js';
import { appendEmptyTableRow } from './dashboard-ui-common.js';

let selectedArtistKey = 'all';
let requestSequence = 0;
let readModelPromise = null;
let latestCharts = null;

const setNotice = (message = '', error = false) => setSharedNotice('spotifyNotice', message, error);
function renderRows(payload = {}) {
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
    name.textContent = [selectedArtistKey === 'all' ? track.artist_name : '', String(track.name || '曲名不明')].filter(Boolean).join(' · ');
    playcount.textContent = numberFormat.format(Number(track.playcount) || 0);
    delta.textContent = signedInteger(track.delta);
    playcount.className = 'spotify-number';
    delta.className = 'spotify-number';
    row.append(rank, name, playcount, delta);
    body.append(row);
  }
}

function syncTrendTitles() {
  const titles = {
    spotifyTrendTitle: 'Spotify 全曲合計再生数前日比推移',
    spotifyTop10YearTrendTitle: 'Spotify 今年リリース上位10曲合計の再生数前日比推移',
  };
  for (const [id, label] of Object.entries(titles)) {
    const title = element(id);
    if (title) title.textContent = label;
  }
}

function renderMetricTables(trend) {
  const entries = {
    spotifyYearTbody: graphTrendSeries(normalizeTrendSeries(trend), selectedArtistKey).flatMap(series => series.points.map(point => [point.snapshot_date, series.artistName, signedInteger(point.top10_year_delta)])),
  };
  for (const [id, rows] of Object.entries(entries)) {
    const body = element(id);
    if (!body) continue;
    body.replaceChildren();
    rows.sort((a, b) => b[0].localeCompare(a[0]) || a[1].localeCompare(b[1], 'ja'));
    for (const [date, name, value] of rows) appendTableRow(body, [formatDate(date), name, value]);
    if (!rows.length) appendEmptyTableRow(body, 'データがありません。', 3);
  }
}

function renderCharts(trend) {
  syncTrendTitles();
  renderTrendChart(trend, {
    containerId: 'spotifyTrendCharts', metricKey: 'total_delta', artistFilter: selectedArtistKey,
    ariaLabel: '櫻坂46・乃木坂46・日向坂46の全曲合計再生数前日比推移',
  });
  renderTrendChart(trend, {
    containerId: 'spotifyTop10YearTrendCharts', metricKey: 'top10_year_delta', artistFilter: selectedArtistKey,
    ariaLabel: '櫻坂46・乃木坂46・日向坂46の今年リリース上位10曲合計の再生数前日比推移',
  });
}

function render(payload, trend) {
  const artistName = payload?.artist?.name || selectedArtistKey;
  const date = element('spotifySnapshotDate');
  if (date) date.textContent = formatDate(payload?.snapshot_date);
  const count = element('spotifyTrackCount');
  if (count) count.textContent = numberFormat.format(Number(payload?.track_count) || 0);
  const delta = element('spotifyTotalDelta');
  if (delta) delta.textContent = signedInteger(payload?.total_delta);
  const title = element('spotifyTableTitle');
  if (title) title.textContent = `${artistName}の再生数一覧`;
  const countLabel = element('spotifyTrackCountLabel');
  if (countLabel) countLabel.textContent = `${artistName}の楽曲数`;
  const deltaLabel = element('spotifyTotalDeltaLabel');
  if (deltaLabel) deltaLabel.textContent = `${artistName}の再生数前日比合計`;
  document.querySelectorAll('[data-spotify-artist]').forEach((button) => {
    const active = button.dataset.spotifyArtist === selectedArtistKey;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  latestCharts = { trend };
  renderCharts(trend);
  renderRows(payload || {});
  renderMetricTables(trend);
  if (!payload?.track_count) setNotice(`${artistName}のSpotify再生数はまだ収集されていません。`);
  else if (payload.carried_forward) setNotice(`${formatDate(payload.snapshot_date)} はSpotify公開値の更新が確認できなかったため、直近の累計値を引き継いでいます。`);
  else setNotice('');
}

async function fetchReadModel({ refresh = false } = {}) {
  readModelPromise = loadSpotifyReadModel({ force: refresh });
  return readModelPromise;
}

export async function loadSpotifyView({ refresh = false } = {}) {
  const sequence = ++requestSequence;
  try {
    setNotice('');
    const model = await fetchReadModel({ refresh });
    if (sequence !== requestSequence) return;
    const payload = selectedArtistKey === 'all' ? spotifyAllTracksPayload(model) : model?.groups?.[selectedArtistKey];
    if (!payload) throw new Error(`${selectedArtistKey}のリードモデルがありません`);
    render(payload, model?.trend || {});
  } catch (error) {
    if (sequence !== requestSequence) return;
    setNotice(`Spotify再生数の取得に失敗しました：${error.message}`, true);
  }
}

globalThis.document?.querySelectorAll('[data-spotify-artist]').forEach((button) => button.addEventListener('click', () => {
  selectedArtistKey = button.dataset.spotifyArtist;
  loadSpotifyView();
}));

if (typeof document !== 'undefined') {
  syncTrendTitles();
  observeDashboardChartResize(element('spotifyView'), () => {
    if (latestCharts) renderCharts(latestCharts.trend);
  }, { delay: 220, enabled: () => Boolean(latestCharts) });
}

