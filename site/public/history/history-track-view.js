function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function usableText(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function normalizedText(value) {
  return usableText(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}

export function displayTrackTitle(row) {
  for (const candidate of [row?.title, row?.display_title, row?.raw_title, row?.isrc, row?.spotify_id]) {
    const text = usableText(candidate);
    if (text) return text;
  }
  return '曲名不明';
}

export function displayTrackArtist(row) {
  for (const candidate of [row?.artist, row?.raw_artist]) {
    const text = usableText(candidate);
    if (text) return text;
  }
  return '—';
}

function trackIdentityKeys(row) {
  const keys = [];
  const add = (value) => {
    const key = usableText(value);
    if (key && !keys.includes(key)) keys.push(key);
  };
  add(row?.track_key);
  if (usableText(row?.isrc)) add(`isrc:${usableText(row.isrc).toUpperCase()}`);
  if (usableText(row?.spotify_id)) add(`spotify:${usableText(row.spotify_id)}`);
  if (usableText(row?.stationhead_track_id)) add(`stationhead:${usableText(row.stationhead_track_id)}`);
  if (usableText(row?.queue_track_id)) add(`queue:${usableText(row.queue_track_id)}`);
  add(`name:${normalizedText(displayTrackTitle(row))}|artist:${normalizedText(displayTrackArtist(row))}`);
  return keys;
}

export function trackIdentity(row) {
  return trackIdentityKeys(row)[0];
}

export function normalizeTrackRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const title = displayTrackTitle(row);
    const artist = displayTrackArtist(row);
    const titleChanged = usableText(row?.title) !== title;
    const artistChanged = artist !== '—' && usableText(row?.artist) !== artist;
    if (!titleChanged && !artistChanged) return row;
    return {
      ...row,
      ...(titleChanged ? { title } : {}),
      ...(artistChanged ? { artist } : {}),
    };
  });
}

export function completeTrackRows(rows) {
  return normalizeTrackRows(rows).filter((row) => (
    row?.period_complete !== false && row?.play_count_excluded !== true
  ));
}

export function aggregateCompleteTrackRows(rows) {
  const validRows = completeTrackRows(rows);
  const parent = new Map();
  const ensure = (key) => { if (!parent.has(key)) parent.set(key, key); };
  const find = (key) => {
    ensure(key);
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    let current = key;
    while (parent.get(current) !== current) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (const row of validRows) {
    const keys = trackIdentityKeys(row);
    keys.forEach(ensure);
    for (let index = 1; index < keys.length; index += 1) union(keys[0], keys[index]);
  }

  const aggregate = new Map();
  for (const row of validRows) {
    const keys = trackIdentityKeys(row);
    const identity = find(keys[0]);
    const count = Math.max(0, finite(row?.play_count) || 0);
    const likes = Math.max(0, finite(row?.like_count) || 0);
    const firstPlayedAt = finite(row?.first_played_at);
    const lastPlayedAt = finite(row?.last_played_at);
    const rowTitle = displayTrackTitle(row);
    const rowArtist = displayTrackArtist(row);
    const current = aggregate.get(identity) || {
      identity,
      title: rowTitle,
      artist: rowArtist,
      play_count: 0,
      like_count: 0,
      first_played_at: null,
      last_played_at: null,
      play_dates: new Set(),
    };
    current.play_count += count;
    current.like_count = Math.max(current.like_count, likes);
    if (current.title === '曲名不明' && rowTitle !== '曲名不明') current.title = rowTitle;
    if (current.artist === '—' && rowArtist !== '—') current.artist = rowArtist;
    if (row?.play_date) current.play_dates.add(String(row.play_date));
    if (firstPlayedAt != null) {
      current.first_played_at = current.first_played_at == null
        ? firstPlayedAt
        : Math.min(current.first_played_at, firstPlayedAt);
    }
    if (lastPlayedAt != null) {
      current.last_played_at = current.last_played_at == null
        ? lastPlayedAt
        : Math.max(current.last_played_at, lastPlayedAt);
    }
    aggregate.set(identity, current);
  }

  return [...aggregate.values()]
    .sort((left, right) => right.play_count - left.play_count
      || right.like_count - left.like_count
      || left.title.localeCompare(right.title, 'ja'))
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      day_count: row.play_dates.size,
      play_dates: [...row.play_dates].sort(),
    }));
}

export function summarizeCompleteTrackRows(rows) {
  const validRows = completeTrackRows(rows);
  const days = new Set(validRows.map((row) => row?.play_date).filter(Boolean));
  const aggregate = aggregateCompleteTrackRows(validRows);
  return {
    days: days.size,
    tracks: aggregate.length,
    total: aggregate.reduce((sum, row) => sum + row.play_count, 0),
    maximum: aggregate.reduce((maximum, row) => Math.max(maximum, row.play_count), 0),
  };
}
