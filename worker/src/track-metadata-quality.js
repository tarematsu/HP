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

function normalizedText(value) {
  return String(value ?? '').trim();
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
  const directTitle = trackTitleValue(track?.title);
  const directArtist = trackArtistValue(track?.artist);
  const display = trackDisplayTitleParts(track?.display_title, directTitle);
  return {
    title: directTitle || display.title,
    artist: directArtist || display.artist,
    displayTitle: display.displayTitle,
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
    const rawTitle = normalizedText(track.title);
    const rawArtist = normalizedText(track.artist);
    const title = resolved.title || null;
    const artist = resolved.artist || null;
    const displayTitle = resolved.displayTitle || null;
    const titleChanged = title !== (rawTitle || null);
    const artistChanged = artist !== (rawArtist || null);
    const displayChanged = displayTitle !== (normalizedText(track.display_title) || null);
    if (!titleChanged && !artistChanged && !displayChanged) return track;
    changed = true;
    return {
      ...track,
      title,
      artist,
      ...(displayTitle ? { display_title: displayTitle } : {}),
    };
  });
  return changed ? { ...queue, tracks } : queue;
}

export function sanitizeMetadataRow(row) {
  if (!row || typeof row !== 'object') return row;
  const resolved = resolvedTrackMetadata(row);
  return {
    ...row,
    title: resolved.title,
    artist: resolved.artist,
    ...(resolved.displayTitle ? { display_title: resolved.displayTitle } : {}),
  };
}
