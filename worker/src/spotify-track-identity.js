function normalizedText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizedArtistIds(artistsJson) {
  let artists;
  try {
    artists = JSON.parse(String(artistsJson || '[]'));
  } catch {
    artists = [];
  }
  return [...new Set(
    (Array.isArray(artists) ? artists : [])
      .map((artist) => String(artist?.id || '').trim())
      .filter(Boolean),
  )].sort();
}

export function spotifySongKey(track) {
  const sourceTrackId = String(track?.track_id || '').trim();
  const name = normalizedText(track?.name);
  const artistIds = normalizedArtistIds(track?.artists_json);
  const durationMs = Number(track?.duration_ms);
  if (!name || !artistIds.length || !Number.isFinite(durationMs) || durationMs < 0) {
    return `track:v1:${sourceTrackId}`;
  }
  const durationSecond = Math.round(durationMs / 1000);
  return `song:v1:${name}\u001f${artistIds.join(',')}\u001f${durationSecond}`;
}
