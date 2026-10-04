const TITLE_PLACEHOLDERS = new Set([
  '曲名不明',
  '曲名…',
  '曲名...',
  'unknown',
  'unknown title',
  '_',
  '-',
  '—',
]);

const ARTIST_PLACEHOLDERS = new Set([
  'アーティスト不明',
  'unknown',
  'unknown artist',
  '_',
  '-',
  '—',
]);

const SPOTIFY_TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

function normalizedText(value) {
  return String(value ?? '').trim();
}

function looksLikeSpotifyTrackId(value) {
  return SPOTIFY_TRACK_ID_PATTERN.test(normalizedText(value));
}

export function trackSpotifyIdValue(track) {
  const explicit = normalizedText(track?.spotify_id);
  if (explicit) return explicit;

  const title = normalizedText(track?.title);
  const artist = normalizedText(track?.artist);
  const displayTitle = normalizedText(track?.display_title);
  if (looksLikeSpotifyTrackId(title)
      && (!artist || artist === title || displayTitle === title)) return title;
  if (looksLikeSpotifyTrackId(artist)
      && (!title || title === artist || displayTitle === artist)) return artist;
  if (looksLikeSpotifyTrackId(displayTitle)
      && (!title || title === displayTitle)
      && (!artist || artist === displayTitle)) return displayTitle;
  return null;
}

function isSpotifyIdPlaceholder(value, spotifyId) {
  const text = normalizedText(value);
  const id = normalizedText(spotifyId);
  return Boolean(text && id && text === id);
}

export function trackTitleValue(value) {
  const text = normalizedText(value);
  if (!text) return null;
  return TITLE_PLACEHOLDERS.has(text.normalize('NFKC').toLowerCase()) ? null : text;
}

export function trackArtistValue(value) {
  const text = normalizedText(value);
  if (!text) return null;
  return ARTIST_PLACEHOLDERS.has(text.normalize('NFKC').toLowerCase()) ? null : text;
}

export function trackDisplayTitleParts(value, knownTitle = null) {
  const displayTitle = trackTitleValue(value);
  const directTitle = trackTitleValue(knownTitle);
  if (!displayTitle) return { displayTitle: null, title: directTitle, artist: null };

  for (const separator of [' — ', ' – ', ' - ', ' · ', ' • ']) {
    const index = displayTitle.lastIndexOf(separator);
    if (index <= 0) continue;
    const left = displayTitle.slice(0, index).trim();
    const right = displayTitle.slice(index + separator.length).trim();
    if (!left || !right) continue;
    if (directTitle && right === directTitle) {
      return { displayTitle, title: directTitle, artist: trackArtistValue(left) };
    }
    if (!directTitle || left === directTitle) {
      return {
        displayTitle,
        title: directTitle || trackTitleValue(left),
        artist: trackArtistValue(right),
      };
    }
  }
  return { displayTitle, title: directTitle || displayTitle, artist: null };
}

function resolvedTrackMetadata(track) {
  const spotifyId = trackSpotifyIdValue(track);
  const rawTitle = trackTitleValue(track?.title);
  const rawArtist = trackArtistValue(track?.artist);
  const directTitle = isSpotifyIdPlaceholder(rawTitle, spotifyId) ? null : rawTitle;
  const directArtist = isSpotifyIdPlaceholder(rawArtist, spotifyId) ? null : rawArtist;
  const displaySource = isSpotifyIdPlaceholder(track?.display_title, spotifyId)
    ? null
    : track?.display_title;
  const display = trackDisplayTitleParts(displaySource, directTitle);
  const displayTitle = isSpotifyIdPlaceholder(display.displayTitle, spotifyId) ? null : display.displayTitle;
  const displayResolvedTitle = isSpotifyIdPlaceholder(display.title, spotifyId) ? null : display.title;
  const displayArtist = isSpotifyIdPlaceholder(display.artist, spotifyId) ? null : display.artist;
  return {
    spotifyId,
    title: directTitle || displayResolvedTitle,
    artist: directArtist || displayArtist,
    displayTitle,
  };
}

export function trackNeedsHydration(track) {
  const resolved = resolvedTrackMetadata(track);
  return !resolved.title
    || !resolved.artist
    || !normalizedText(track?.thumbnail_url);
}

export function sanitizeQueueTrackMetadata(queue) {
  if (!Array.isArray(queue?.tracks) || !queue.tracks.length) return queue;
  let changed = false;
  const tracks = queue.tracks.map((track) => {
    if (!track || typeof track !== 'object') return track;
    const resolved = resolvedTrackMetadata(track);
    const rawSpotifyId = normalizedText(track.spotify_id);
    const rawTitle = normalizedText(track.title);
    const rawArtist = normalizedText(track.artist);
    const spotifyId = resolved.spotifyId || null;
    const title = resolved.title || null;
    const artist = resolved.artist || null;
    const displayTitle = resolved.displayTitle || null;
    const spotifyChanged = spotifyId !== (rawSpotifyId || null);
    const titleChanged = title !== (rawTitle || null);
    const artistChanged = artist !== (rawArtist || null);
    const displayChanged = displayTitle !== (normalizedText(track.display_title) || null);
    if (!spotifyChanged && !titleChanged && !artistChanged && !displayChanged) return track;
    changed = true;
    const hasSpotifyId = Object.prototype.hasOwnProperty.call(track, 'spotify_id');
    const hasDisplayTitle = Object.prototype.hasOwnProperty.call(track, 'display_title');
    return {
      ...track,
      ...(spotifyId || hasSpotifyId ? { spotify_id: spotifyId } : {}),
      title,
      artist,
      ...(displayTitle || hasDisplayTitle ? { display_title: displayTitle } : {}),
    };
  });
  return changed ? { ...queue, tracks } : queue;
}

export function sanitizeMetadataRow(row) {
  if (!row || typeof row !== 'object') return row;
  const resolved = resolvedTrackMetadata(row);
  const hasSpotifyId = Object.prototype.hasOwnProperty.call(row, 'spotify_id');
  const hasDisplayTitle = Object.prototype.hasOwnProperty.call(row, 'display_title');
  return {
    ...row,
    ...(resolved.spotifyId || hasSpotifyId ? { spotify_id: resolved.spotifyId || null } : {}),
    title: resolved.title,
    artist: resolved.artist,
    ...(resolved.displayTitle || hasDisplayTitle ? { display_title: resolved.displayTitle || null } : {}),
  };
}
