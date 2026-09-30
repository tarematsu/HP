import {
  byId as element,
  fullDate as formatDate,
  integerFormat as numberFormat,
  setNotice as setSharedNotice,
} from './dashboard-ui-common.js?v=20260930.1';

const NAMES = {
  sakurazaka46: '櫻坂46',
  nogizaka46: '乃木坂46',
  hinatazaka46: '日向坂46',
};
let modelPromise;

function formatDelta(value) {
  if (value == null || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number)
    ? `${number > 0 ? '+' : ''}${numberFormat.format(number)}`
    : '-';
}

function renderRows(payload) {
  const body = element('spotifyTbody');
  if (!body) return;
  body.replaceChildren();
  for (const track of payload?.tracks || []) {
    const row = document.createElement('tr');
    for (const [value, className] of [
      [numberFormat.format(Number(track.rank) || 0), ''],
      [track.name || '曲名不明', ''],
      [numberFormat.format(Number(track.playcount) || 0), 'spotify-number'],
      [formatDelta(track.delta), 'spotify-number'],
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (className) cell.className = className;
      row.append(cell);
    }
    body.append(row);
  }
}

function renderPayload(key, payload) {
  const name = NAMES[key];
  const title = element('spotifyTableTitle');
  if (title) title.textContent = `${name} 再生数一覧`;
  element('spotifySummary')?.setAttribute('aria-label', `${name} Spotify再生数概要`);
  const countLabel = element('spotifyTrackCountLabel');
  if (countLabel) countLabel.textContent = `${name} 楽曲数`;
  const deltaLabel = element('spotifyTotalDeltaLabel');
  if (deltaLabel) deltaLabel.textContent = `${name} 再生数前日比合計`;
  const date = element('spotifySnapshotDate');
  if (date) date.textContent = formatDate(payload?.snapshot_date);
  const count = element('spotifyTrackCount');
  if (count) count.textContent = numberFormat.format(Number(payload?.track_count) || 0);
  const total = element('spotifyTotalDelta');
  if (total) total.textContent = formatDelta(payload?.total_delta);
  renderRows(payload);

  document.querySelectorAll('.spotify-artist-button').forEach((button) => {
    const active = button.dataset.spotifyArtist === key;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  const message = !payload?.track_count
    ? `${name}のSpotify再生数はまだ収集されていません。`
    : payload.carried_forward
      ? `${formatDate(payload.snapshot_date)} はSpotify公開値の更新が確認できなかったため、直近の累計値を引き継いでいます。`
      : '';
  setSharedNotice('spotifyNotice', message);
}

async function selectArtist(key) {
  if (!NAMES[key]) return;
  try {
    modelPromise ||= fetch('/api/spotify-playcounts?artists=sakamichi').then(async (response) => {
      const model = await response.json();
      if (!response.ok || !model.ok) throw new Error(model.error || `HTTP ${response.status}`);
      return model;
    });
    const model = await modelPromise;
    const payload = model?.groups?.[key];
    if (!payload) throw new Error(`${NAMES[key]}のリードモデルがありません`);
    renderPayload(key, payload);
  } catch (error) {
    modelPromise = null;
    setSharedNotice('spotifyNotice', `Spotify再生数の取得に失敗しました: ${error.message}`, true);
  }
}

document.querySelectorAll('.spotify-artist-button').forEach((button) => {
  button.addEventListener('click', () => selectArtist(button.dataset.spotifyArtist));
});