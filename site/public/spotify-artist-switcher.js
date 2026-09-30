import { fullDate, integerFormat, setNotice } from './dashboard-ui-common.js?v=20260930.1';

const names = { sakurazaka46: '櫻坂46', nogizaka46: '乃木坂46', hinatazaka46: '日向坂46' };
const el = (id) => document.getElementById(id);
const delta = (value) => value == null || value === '' ? '-' : `${Number(value) > 0 ? '+' : ''}${integerFormat.format(Number(value))}`;
let model;

function render(key, payload) {
  const name = names[key];
  el('spotifyTableTitle').textContent = `${name}の再生数一覧`;
  el('spotifySummary').setAttribute('aria-label', `${name} Spotify再生数概要`);
  el('spotifyTrackCountLabel').textContent = `${name}の楽曲数`;
  el('spotifyTotalDeltaLabel').textContent = `${name}の再生数前日比合計`;
  el('spotifySnapshotDate').textContent = fullDate(payload.snapshot_date);
  el('spotifyTrackCount').textContent = integerFormat.format(payload.track_count || 0);
  el('spotifyTotalDelta').textContent = delta(payload.total_delta);

  const body = el('spotifyTbody');
  body.replaceChildren();
  for (const track of payload.tracks || []) {
    const row = document.createElement('tr');
    const values = [track.rank || 0, track.name || '曲名不明', track.playcount || 0, delta(track.delta)];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = index === 0 || index === 2 ? integerFormat.format(value) : value;
      if (index > 1) cell.className = 'spotify-number';
      row.append(cell);
    });
    body.append(row);
  }

  document.querySelectorAll('.spotify-artist-button').forEach((button) => {
    const active = button.dataset.spotifyArtist === key;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  setNotice('spotifyNotice', !payload.track_count
    ? `${name}のSpotify再生数はまだ収集されていません。`
    : payload.carried_forward
      ? `${fullDate(payload.snapshot_date)} はSpotify公開値の更新が確認できなかったため、直近の累計値を引き継いでいます。`
      : '');
}

async function select(key) {
  if (!names[key]) return;
  try {
    model ||= fetch('/api/spotify-playcounts?artists=sakamichi').then(async (response) => {
      const value = await response.json();
      if (!response.ok || !value.ok) throw new Error(value.error || `HTTP ${response.status}`);
      return value;
    });
    const payload = (await model)?.groups?.[key];
    if (!payload) throw new Error(`${names[key]}のリードモデルがありません`);
    render(key, payload);
  } catch (error) {
    model = null;
    setNotice('spotifyNotice', `Spotify再生数の取得に失敗しました: ${error.message}`, true);
  }
}

document.querySelectorAll('.spotify-artist-button').forEach((button) => button.addEventListener('click', () => select(button.dataset.spotifyArtist)));