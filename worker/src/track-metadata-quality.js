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

export function trackNeedsHydration(track) {
  return !trackTitleValue(track?.title)
    || !trackArtistValue(track?.artist)
    || !normalizedText(track?.thumbnail_url);
}

export function sanitizeQueueTrackMetadata(queue) {
  if (!Array.isArray(queue?.tracks) || !queue.tracks.length) return queue;
  let changed = false;
  const tracks = queue.tracks.map((track) => {
    if (!track || typeof track !== 'object') return track;
    const rawTitle = normalizedText(track.title);
    const rawArtist = normalizedText(track.artist);
    const titleIsPlaceholder = Boolean(rawTitle && !trackTitleValue(track.title));
    const artistIsPlaceholder = Boolean(rawArtist && !trackArtistValue(track.artist));
    if (!titleIsPlaceholder && !artistIsPlaceholder) return track;
    changed = true;
    return {
      ...track,
      ...(titleIsPlaceholder ? { title: null } : {}),
      ...(artistIsPlaceholder ? { artist: null } : {}),
    };
  });
  return changed ? { ...queue, tracks } : queue;
}

export function sanitizeMetadataRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    title: trackTitleValue(row.title),
    artist: trackArtistValue(row.artist),
  };
}
