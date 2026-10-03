import {
  fullDate as formatDate,
  integerFormat as numberFormat,
  safeInteger as integer,
  setNotice as setSharedNotice,
  signedInteger,
} from './dashboard-ui-common.js?v=20260930.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';
import {
  MUSIC_ARTIST_ORDER,
  replaceMusicTableBody,
} from './music-service-runtime-common.js?v=20261004.1';

const ARTIST_KEYS = Object.freeze(MUSIC_ARTIST_ORDER.slice(0, 3));
const ARTIST_NAMES = Object.freeze({
  sakurazaka46: '櫻坂46',
  nogizaka46: '乃木坂46',
  hinatazaka46: '日向坂46',
});
let readModelPromise = null;

function compareTracks(left, right) {
  const leftDelta = integer(left?.delta);
  const rightDelta = integer(right?.delta);
  if (leftDelta == null && rightDelta != null) return 1;
  if (leftDelta != null && rightDelta == null) return -1;
  if (leftDelta != null && rightDelta != null && leftDelta !== rightDelta) return rightDelta - leftDelta;

  const leftPlaycount = Math.max(0, integer(left?.playcount) ?? 0);
  const rightPlaycount = Math.max(0, integer(right?.playcount) ?? 0);
  if (leftPlaycount !== rightPlaycount) return rightPlaycount - leftPlaycount;

  const artistOrder = ARTIST_KEYS.indexOf(left?.artist_key) - ARTIST_KEYS.indexOf(right?.artist_key);
  if (artistOrder !== 0) return artistOrder;
  return String(left?.name || '').localeCompare(String(right?.name || ''), 'ja');
}

function trackIdentity(track) {
  const canonicalId = integer(track?.track_id);
  if (canonicalId != null) return `track:${canonicalId}`;
  const spotifyId = String(track?.spotify_track_id || '').trim();
  if (spotifyId) return `spotify:${spotifyId}`;
  return `${track?.artist_key || ''}:${String(track?.name || '').normalize('NFKC').trim().toLowerCase()}`;
}

export function spotifyAllTracksPayload(model = {}) {
  const tracks = [];
  const snapshotDates = [];
  const carriedForwardArtists = [];

  for (const artistKey of ARTIST_KEYS) {
    const group = model?.groups?.[artistKey];
    if (!group) continue;
    const artistName = String(group?.artist?.name || ARTIST_NAMES[artistKey]);
    const snapshotDate = String(group?.snapshot_date || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) snapshotDates.push([artistName, snapshotDate]);
    if (group?.carried_forward) carriedForwardArtists.push(artistName);
    for (const track of Array.isArray(group?.tracks) ? group.tracks : []) {
      tracks.push({ ...track, artist_key: artistKey, artist_name: artistName });
    }
  }

  tracks.sort(compareTracks);
  const seen = new Set();
  const uniqueTracks = [];
  for (const track of tracks) {
    const identity = trackIdentity(track);
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueTracks.push({ ...track, rank: uniqueTracks.length + 1 });
  }

  return {
    artist: { key: 'all', name: '坂道3グループ' },
    snapshot_date: snapshotDates.map(([, date]) => date).sort().at(-1) || null,
    snapshot_dates: snapshotDates,
    carried_forward_artists: carriedForwardArtists,
    track_count: uniqueTracks.length,
    tracks: uniqueTracks,
  };
}

function renderRows(payload) {
  const body = replaceMusicTableBody('spotifyTbody');
  if (!body) return;
  for (const track of payload.tracks || []) {
    const row = appendTableRow(body, [
      numberFormat.format(Number(track.rank) || 0),
      `${track.artist_name || ''} · ${String(track.name || '曲名不明')}`,
      { text:numberFormat.format(Number(track.playcount) || 0), className:'spotify-number' },
      { text:signedInteger(track.delta), className:'spotify-number' },
    ]);
    if (row) row.dataset.artistKey = track.artist_key || '';
  }
}

function syncButtons(activeValue) {
  document.querySelectorAll('[data-spotify-artist]').forEach((button) => {
    const active = button.dataset.spotifyArtist === activeValue;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderAll(model) {
  const payload = spotifyAllTracksPayload(model);
  const title = document.getElementById('spotifyTableTitle');
  if (title) title.textContent = '坂道3グループの再生数一覧';

  const date = document.getElementById('spotifySnapshotDate');
  if (date) {
    date.textContent = formatDate(payload.snapshot_date);
    date.title = payload.snapshot_dates.map(([artist, value]) => `${artist}: ${formatDate(value)}`).join(' / ');
  }

  renderRows(payload);
  syncButtons('all');

  if (!payload.track_count) {
    setSharedNotice('spotifyNotice', '坂道3グループのSpotify再生数はまだ収集されていません。');
  } else if (payload.carried_forward_artists.length) {
    setSharedNotice('spotifyNotice', `${payload.carried_forward_artists.join('・')}はSpotify公開値の更新待ちのため、直近の累計値を表示しています。`);
  } else {
    setSharedNotice('spotifyNotice', '');
  }
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

async function selectAll() {
  try {
    renderAll(await fetchReadModel());
  } catch (error) {
    setSharedNotice('spotifyNotice', `Spotify再生数の取得に失敗しました：${error.message}`, true);
  }
}

export function installSpotifyAllTracksFilter() {
  const allButton = document.querySelector('[data-spotify-artist="all"]');
  if (!allButton || allButton.dataset.spotifyAllInstalled === '1') return;
  allButton.dataset.spotifyAllInstalled = '1';
  allButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    void selectAll();
  }, true);

  document.querySelectorAll('[data-spotify-artist]').forEach((button) => {
    if (button === allButton) return;
    button.addEventListener('click', () => {
      allButton.classList.remove('active');
      allButton.setAttribute('aria-pressed', 'false');
    }, true);
  });
}
