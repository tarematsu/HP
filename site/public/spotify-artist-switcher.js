import {
  byId as element,
  fullDate as formatDate,
  integerFormat as numberFormat,
  safeInteger as integer,
  setNotice as setSharedNotice,
} from './dashboard-ui-common.js?v=20260930.1';

const ARTISTS = Object.freeze({
  sakurazaka46: Object.freeze({ key: 'sakurazaka46', name: '櫻坂46' }),
  nogizaka46: Object.freeze({ key: 'nogizaka46', name: '乃木坂46' }),
  hinatazaka46: Object.freeze({ key: 'hinatazaka46', name: '日向坂46' }),
});

let selectedArtistKey = 'sakurazaka46';
let modelPromise = null;
let applying = false;

function formatDelta(value) {
  const number = integer(value);
  if (number == null) return '-';
  return number > 0 ? `+${numberFormat.format(number)}` : numberFormat.format(number);
}

function setNotice(message = '', error = false) {
  setSharedNotice('spotifyNotice', message, error);
}

function updateButtons() {
  document.querySelectorAll('[data-spotify-artist]').forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const active = button.dataset.spotifyArtist === selectedArtistKey;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

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
    name.textContent = String(track.name || '曲名不明');
    playcount.textContent = numberFormat.format(Number(track.playcount) || 0);
    delta.textContent = formatDelta(track.delta);
    playcount.className = 'spotify-number';
    delta.className = 'spotify-number';
    row.append(rank, name, playcount, delta);
    body.append(row);
  }
}

function renderPayload(payload) {
  const artist = ARTISTS[selectedArtistKey];
  if (!artist || !payload) return;
  applying = true;

  const panel = element('spotifyDetailPanel');
  if (panel) panel.dataset.spotifyArtist = selectedArtistKey;
  const title = element('spotifyTableTitle');
  if (title) title.textContent = `${artist.name} 再生数一覧`;
  const summary = element('spotifySummary');
  if (summary) summary.setAttribute('aria-label', `${artist.name} Spotify再生数概要`);
  const countLabel = element('spotifyTrackCountLabel');
  if (countLabel) countLabel.textContent = `${artist.name} 楽曲数`;
  const totalLabel = element('spotifyTotalDeltaLabel');
  if (totalLabel) totalLabel.textContent = `${artist.name} 再生数前日比合計`;
  const date = element('spotifySnapshotDate');
  if (date) date.textContent = formatDate(payload.snapshot_date);
  const count = element('spotifyTrackCount');
  if (count) count.textContent = numberFormat.format(Number(payload.track_count) || 0);
  const total = element('spotifyTotalDelta');
  if (total) total.textContent = formatDelta(payload.total_delta);
  renderRows(payload);
  updateButtons();

  if (!payload.track_count) {
    setNotice(`${artist.name}のSpotify再生数はまだ収集されていません。`);
  } else if (payload.carried_forward) {
    setNotice(`${formatDate(payload.snapshot_date)} はSpotify公開値の更新が確認できなかったため、直近の累計値を引き継いでいます。`);
  } else {
    setNotice('');
  }

  setTimeout(() => {
    applying = false;
  }, 0);
}

async function fetchModel({ refresh = false } = {}) {
  if (refresh) modelPromise = null;
  if (!modelPromise) {
    modelPromise = fetch('/api/spotify-playcounts?artists=sakamichi')
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload;
      })
      .catch((error) => {
        modelPromise = null;
        throw error;
      });
  }
  return modelPromise;
}

async function selectArtist(key) {
  if (!ARTISTS[key]) return;
  selectedArtistKey = key;
  updateButtons();
  try {
    const model = await fetchModel();
    const payload = model?.groups?.[selectedArtistKey];
    if (!payload) throw new Error(`${ARTISTS[selectedArtistKey].name}のリードモデルがありません`);
    renderPayload(payload);
  } catch (error) {
    setNotice(`Spotify再生数の取得に失敗しました: ${error.message}`, true);
  }
}

for (const button of document.querySelectorAll('.spotify-artist-button[data-spotify-artist]')) {
  button.addEventListener('click', () => selectArtist(button.dataset.spotifyArtist));
}
updateButtons();

const body = element('spotifyTbody');
if (body) {
  const observer = new MutationObserver(() => {
    if (applying || selectedArtistKey === 'sakurazaka46') return;
    queueMicrotask(async () => {
      if (applying || selectedArtistKey === 'sakurazaka46') return;
      try {
        const model = await fetchModel();
        const payload = model?.groups?.[selectedArtistKey];
        if (payload) renderPayload(payload);
      } catch {
        // The primary Spotify runtime owns the visible error state on refresh failures.
      }
    });
  });
  observer.observe(body, { childList: true, subtree: true });
}