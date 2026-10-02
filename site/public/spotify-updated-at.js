import { dashboardDateTimeFormatter } from './dashboard-time.js?v=20261003.1';

const ARTIST_KEYS = Object.freeze(['sakurazaka46', 'nogizaka46', 'hinatazaka46']);
const ARTIST_NAMES = Object.freeze({
  sakurazaka46: '櫻坂46',
  nogizaka46: '乃木坂46',
  hinatazaka46: '日向坂46',
});
const JST_UPDATE_TIME = dashboardDateTimeFormatter({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

let readModelPromise = null;
let currentArtistKey = 'sakurazaka46';

function validTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function latestSpotifyCollectedAt(model = {}, artistKey = 'all') {
  const keys = artistKey === 'all' ? ARTIST_KEYS : [artistKey];
  let latest = null;
  for (const key of keys) {
    const tracks = model?.groups?.[key]?.tracks;
    for (const track of Array.isArray(tracks) ? tracks : []) {
      const timestamp = validTimestamp(track?.collected_at);
      if (timestamp != null && (latest == null || timestamp > latest)) latest = timestamp;
    }
  }
  return latest;
}

export function formatSpotifyUpdatedAt(value) {
  const timestamp = validTimestamp(value);
  if (timestamp == null) return '-';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '-' : JST_UPDATE_TIME.format(date);
}

function updatedAtTitle(model, artistKey) {
  const keys = artistKey === 'all' ? ARTIST_KEYS : [artistKey];
  return keys.map((key) => {
    const label = ARTIST_NAMES[key] || key;
    return `${label}: ${formatSpotifyUpdatedAt(latestSpotifyCollectedAt(model, key))}`;
  }).join(' / ');
}

function renderUpdatedAt(model) {
  const output = document.getElementById('spotifyUpdatedAt');
  if (!output) return;
  output.textContent = formatSpotifyUpdatedAt(latestSpotifyCollectedAt(model, currentArtistKey));
  output.title = updatedAtTitle(model, currentArtistKey);
}

async function fetchReadModel() {
  if (!readModelPromise) {
    readModelPromise = fetch('/api/spotify-playcounts?artists=sakamichi')
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload;
      })
      .catch((error) => {
        readModelPromise = null;
        throw error;
      });
  }
  return readModelPromise;
}

export function installSpotifyUpdatedAt() {
  const output = document.getElementById('spotifyUpdatedAt');
  if (!output || output.dataset.spotifyUpdatedAtInstalled === '1') return;
  output.dataset.spotifyUpdatedAtInstalled = '1';

  document.querySelectorAll('[data-spotify-artist]').forEach((button) => {
    button.addEventListener('click', () => {
      currentArtistKey = button.dataset.spotifyArtist || 'sakurazaka46';
      if (readModelPromise) void readModelPromise.then(renderUpdatedAt).catch(() => {});
    }, true);
  });

  void fetchReadModel().then(renderUpdatedAt).catch(() => {
    output.textContent = '-';
    output.removeAttribute('title');
  });
}
