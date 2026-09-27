const ARTISTS = Object.freeze({
  nogizaka46: '乃木坂46',
  sakurazaka46: '櫻坂46',
  hinatazaka46: '日向坂46',
});

const DEFAULT_ARTIST = 'sakurazaka46';
const numberFormat = new Intl.NumberFormat('ja-JP');
let activeArtist = DEFAULT_ARTIST;
let loading = false;
const payloadCache = new Map();

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

function formatDelta(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return '-';
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

function render(payload) {
  const artistName = payload?.artist?.name || ARTISTS[activeArtist];
  const title = element('spotifyTableTitle');
  if (title) title.textContent = `${artistName} 再生数一覧`;
  const date = element('spotifySnapshotDate');
  if (date) date.textContent = formatDate(payload?.snapshot_date);
  const count = element('spotifyTrackCount');
  if (count) count.textContent = numberFormat.format(Number(payload?.track_count) || 0);
  const delta = element('spotifyTotalDelta');
  if (delta) delta.textContent = formatDelta(payload?.total_delta);
  renderRows(payload || {});

  if (!payload?.track_count) {
    setNotice(`${artistName}のSpotify再生数はまだ収集されていません。`);
  } else if (payload.carried_forward) {
    setNotice(`${formatDate(payload.snapshot_date)} はSpotify公開値の更新が確認できなかったため、直近の累計値を引き継いでいます。`);
  } else {
    setNotice('');
  }
}

async function fetchPayload(artistKey) {
  if (payloadCache.has(artistKey)) return payloadCache.get(artistKey);
  const response = await fetch(`/api/spotify-playcounts?artist=${encodeURIComponent(artistKey)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  payloadCache.set(artistKey, payload);
  return payload;
}

export async function loadSpotifyView({ artist = activeArtist, refresh = false } = {}) {
  const requested = ARTISTS[artist] ? artist : DEFAULT_ARTIST;
  activeArtist = requested;
  updateArtistButtons();
  if (refresh) payloadCache.delete(requested);
  if (loading) return;
  loading = true;
  try {
    setNotice('');
    const payload = await fetchPayload(requested);
    if (activeArtist !== requested) return;
    render(payload);
  } catch (error) {
    if (activeArtist !== requested) return;
    setNotice(`Spotify再生数の取得に失敗しました: ${error.message}`, true);
  } finally {
    loading = false;
  }
}

document.getElementById('spotifyView')?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-spotify-artist]');
  if (!button) return;
  const artist = button.dataset.spotifyArtist;
  if (!ARTISTS[artist] || artist === activeArtist) return;
  void loadSpotifyView({ artist });
});
