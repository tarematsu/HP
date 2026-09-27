const ARTISTS = Object.freeze({
  nogizaka46: '乃木坂46',
  sakurazaka46: '櫻坂46',
  hinatazaka46: '日向坂46',
});

const DEFAULT_ARTIST = 'sakurazaka46';
const numberFormat = new Intl.NumberFormat('ja-JP');
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

function renderComparison(comparison = []) {
  const chart = element('spotifyComparisonChart');
  if (!chart) return;
  chart.replaceChildren();

  const byArtist = new Map(comparison.map((item) => [item?.artist?.key, item]));
  const values = Object.keys(ARTISTS)
    .map((key) => deltaNumber(byArtist.get(key)?.total_delta))
    .filter((value) => value != null);
  const maximum = Math.max(1, ...values.map((value) => Math.abs(value)));

  for (const [artistKey, artistName] of Object.entries(ARTISTS)) {
    const item = byArtist.get(artistKey);
    const value = deltaNumber(item?.total_delta);
    const row = document.createElement('div');
    row.className = 'spotify-comparison-row';
    if (artistKey === activeArtist) row.classList.add('is-active');

    const name = document.createElement('span');
    name.className = 'spotify-comparison-name';
    name.textContent = artistName;

    const track = document.createElement('div');
    track.className = 'spotify-comparison-track';
    const bar = document.createElement('div');
    bar.className = 'spotify-comparison-bar';
    const ratio = value == null ? 0 : Math.max(0, Math.min(100, Math.abs(value) / maximum * 100));
    bar.style.setProperty('--spotify-comparison-width', `${ratio}%`);
    track.append(bar);

    const total = document.createElement('strong');
    total.className = 'spotify-comparison-value spotify-number';
    total.textContent = formatDelta(value);
    row.setAttribute('aria-label', `${artistName} 前回比合計 ${formatDelta(value)}`);
    row.append(name, track, total);
    chart.append(row);
  }
}

function render(payload, comparison) {
  const artistName = payload?.artist?.name || ARTISTS[activeArtist];
  const title = element('spotifyTableTitle');
  if (title) title.textContent = `${artistName} 再生数一覧`;
  const date = element('spotifySnapshotDate');
  if (date) date.textContent = formatDate(payload?.snapshot_date);
  const count = element('spotifyTrackCount');
  if (count) count.textContent = numberFormat.format(Number(payload?.track_count) || 0);
  const delta = element('spotifyTotalDelta');
  if (delta) delta.textContent = formatDelta(payload?.total_delta);
  renderComparison(comparison);
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
    render(payload, Array.isArray(model.comparison) ? model.comparison : []);
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
