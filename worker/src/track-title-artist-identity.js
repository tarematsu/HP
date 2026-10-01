import {
  trackArtistValue,
  trackTitleValue,
} from './track-metadata-quality.js';

const QUERY_BINDING_CHUNK_SIZE = 79;
const IDENTITY_LRU_LIMIT = 1_500;
const IDENTITY_POSITIVE_TTL_MS = 20 * 60_000;
const IDENTITY_NEGATIVE_TTL_MS = 6 * 60 * 60_000;
const identityLru = new Map();

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizedIsrc(value) {
  const normalized = String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized) ? normalized : null;
}

function normalizedName(value, type, nfkc = true) {
  const usable = type === 'title' ? trackTitleValue(value) : trackArtistValue(value);
  if (!usable) return null;
  const source = nfkc ? usable.normalize('NFKC') : usable;
  return source.replace(/\s+/g, ' ').trim().toLowerCase();
}

function identityKey(value, nfkc = true) {
  const title = normalizedName(value?.title, 'title', nfkc);
  const artist = normalizedName(value?.artist, 'artist', nfkc);
  return title && artist ? `${title}\u001f${artist}` : null;
}

export function trackTitleArtistKey(value) {
  return identityKey(value, true);
}

function identityLookupKeys(value) {
  const keys = new Set();
  const canonical = identityKey(value, true);
  const raw = identityKey(value, false);
  if (canonical) keys.add(canonical);
  if (raw) keys.add(raw);
  return [...keys];
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

function missingSchema(error) {
  return /no such table|no such column/i.test(String(error?.message || error));
}

async function safeRows(db, sql, bindings) {
  if (!db?.prepare || !bindings.length) return [];
  try {
    const statement = db.prepare(sql).bind(...bindings);
    if (typeof statement?.all !== 'function') return [];
    const result = await statement.all();
    return result?.results || [];
  } catch (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
}

async function safeRun(db, sql, bindings) {
  if (!db?.prepare) return false;
  try {
    const statement = db.prepare(sql).bind(...bindings);
    if (typeof statement?.run !== 'function') return false;
    await statement.run();
    return true;
  } catch (error) {
    if (missingSchema(error)) return false;
    throw error;
  }
}

function touchLru(key, entry) {
  identityLru.delete(key);
  identityLru.set(key, entry);
  while (identityLru.size > IDENTITY_LRU_LIMIT) {
    identityLru.delete(identityLru.keys().next().value);
  }
}

function lruGet(key, now = Date.now()) {
  const entry = identityLru.get(key);
  if (!entry) return { hit: false, row: null };
  if (entry.expiresAt <= now) {
    identityLru.delete(key);
    return { hit: false, row: null };
  }
  touchLru(key, entry);
  return { hit: true, row: entry.row };
}

function lruSetPositive(key, row, now = Date.now()) {
  touchLru(key, { row: { ...row, title_artist_identity: key }, expiresAt: now + IDENTITY_POSITIVE_TTL_MS });
}

function lruSetNegative(key, now = Date.now()) {
  touchLru(key, { row: null, expiresAt: now + IDENTITY_NEGATIVE_TTL_MS });
}

function titleVariants(requests, limit) {
  const result = new Set();
  for (const request of requests || []) {
    if (result.size >= limit * 2) break;
    const title = trackTitleValue(request?.title);
    if (!title) continue;
    result.add(title);
    result.add(title.normalize('NFKC'));
  }
  return [...result].filter(Boolean).slice(0, limit * 2);
}

function requestedKeys(tracks, limit) {
  const result = new Map();
  for (const track of tracks || []) {
    if (result.size >= limit) break;
    if (text(track?.spotify_id) || normalizedIsrc(track?.isrc)) continue;
    const key = trackTitleArtistKey(track);
    if (!key || result.has(key)) continue;
    result.set(key, {
      title: trackTitleValue(track?.title),
      artist: trackArtistValue(track?.artist),
      lookupKeys: identityLookupKeys(track),
    });
  }
  return result;
}

function candidateKey(row) {
  return trackTitleArtistKey(row);
}

function analyzeRows(requests, rows) {
  const candidates = new Map();
  for (const row of rows || []) {
    const key = candidateKey(row);
    if (!key || !requests.has(key)) continue;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(row);
  }

  const resolved = new Map();
  const blocked = new Set();
  for (const [key] of requests) {
    const matches = candidates.get(key) || [];
    if (!matches.length) continue;
    const spotifyIds = new Set(matches.map((row) => text(row?.spotify_id)).filter(Boolean));
    const isrcs = new Set(matches.map((row) => normalizedIsrc(row?.isrc)).filter(Boolean));
    if (spotifyIds.size > 1 || isrcs.size > 1) {
      blocked.add(key);
      continue;
    }
    const spotifyId = spotifyIds.size === 1 ? [...spotifyIds][0] : null;
    const isrc = isrcs.size === 1 ? [...isrcs][0] : null;
    if (!spotifyId && !isrc) continue;

    const compatible = matches.filter((row) => {
      const rowSpotify = text(row?.spotify_id);
      const rowIsrc = normalizedIsrc(row?.isrc);
      return (!spotifyId || !rowSpotify || rowSpotify === spotifyId)
        && (!isrc || !rowIsrc || rowIsrc === isrc);
    }).sort((left, right) => {
      const leftScore = Number(Boolean(left?.thumbnail_url)) * 1_000_000
        + Number(left?.fetched_at || 0);
      const rightScore = Number(Boolean(right?.thumbnail_url)) * 1_000_000
        + Number(right?.fetched_at || 0);
      return rightScore - leftScore;
    });
    const best = compatible[0] || matches[0] || {};
    resolved.set(key, {
      title: requests.get(key)?.title,
      artist: requests.get(key)?.artist,
      spotify_id: spotifyId,
      isrc,
      thumbnail_url: text(best?.thumbnail_url),
      fetched_at: Number(best?.fetched_at || 0) || null,
      title_artist_identity: key,
    });
  }
  return { resolved, blocked };
}

async function persistentCacheRows(db, requests) {
  if (!db?.prepare || !requests.size) return [];
  const lookupToCanonical = new Map();
  for (const [key, request] of requests) {
    for (const lookupKey of request.lookupKeys || [key]) lookupToCanonical.set(lookupKey, key);
  }
  const lookupKeys = [...lookupToCanonical.keys()];
  const rows = [];
  for (let offset = 0; offset < lookupKeys.length; offset += QUERY_BINDING_CHUNK_SIZE) {
    const part = lookupKeys.slice(offset, offset + QUERY_BINDING_CHUNK_SIZE);
    const found = await safeRows(db, `SELECT identity_key,spotify_id,isrc,title,artist,thumbnail_url,
        fetched_at,unresolved_until,updated_at
      FROM sh_track_identity_cache
      WHERE identity_key IN (${placeholders(part.length)})`, part);
    for (const row of found) {
      const canonical = lookupToCanonical.get(String(row?.identity_key || ''));
      if (canonical) rows.push({ ...row, title_artist_identity: canonical });
    }
  }
  return rows;
}

async function sourceRows(db, requests, source) {
  if (!db?.prepare || !requests.size) return [];
  const titles = titleVariants([...requests.values()], requests.size);
  if (!titles.length) return [];
  const rows = [];
  for (let offset = 0; offset < titles.length; offset += QUERY_BINDING_CHUNK_SIZE) {
    const part = titles.slice(offset, offset + QUERY_BINDING_CHUNK_SIZE);
    const marks = placeholders(part.length);
    const where = `WHERE title IS NOT NULL AND artist IS NOT NULL
        AND TRIM(title) COLLATE NOCASE IN (${marks})`;
    if (source === 'dictionary') {
      rows.push(...await safeRows(db, `SELECT spotify_id,isrc,title,artist,
          thumbnail_url,metadata_fetched_at AS fetched_at
        FROM sh_track_dictionary ${where}`, part));
    } else if (source === 'metadata') {
      rows.push(...await safeRows(db, `SELECT spotify_id,isrc,title,artist,
          thumbnail_url,fetched_at
        FROM sh_track_metadata ${where}`, part));
    } else if (source === 'tracks') {
      rows.push(...await safeRows(db, `SELECT spotify_id,isrc,title,artist,
          NULL AS thumbnail_url,last_seen_at AS fetched_at
        FROM sh_tracks ${where}`, part));
    } else if (source === 'isrc') {
      rows.push(...await safeRows(db, `SELECT NULL AS spotify_id,isrc,title,artist,
          thumbnail_url,fetched_at
        FROM sh_isrc_metadata ${where}`, part));
    }
  }
  return rows;
}

async function persistCache(db, resolved, negativeRequests, now) {
  if (!db?.prepare || (!resolved.size && !negativeRequests.size)) return;
  const sql = `INSERT INTO sh_track_identity_cache(
      identity_key,spotify_id,isrc,title,artist,thumbnail_url,
      fetched_at,unresolved_until,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(identity_key) DO UPDATE SET
      spotify_id=excluded.spotify_id,
      isrc=excluded.isrc,
      title=excluded.title,
      artist=excluded.artist,
      thumbnail_url=COALESCE(excluded.thumbnail_url,sh_track_identity_cache.thumbnail_url),
      fetched_at=MAX(sh_track_identity_cache.fetched_at,excluded.fetched_at),
      unresolved_until=excluded.unresolved_until,
      updated_at=excluded.updated_at`;
  const statements = [];
  for (const [key, row] of resolved) {
    statements.push([
      key,
      text(row?.spotify_id),
      normalizedIsrc(row?.isrc),
      text(row?.title),
      text(row?.artist),
      text(row?.thumbnail_url),
      Number(row?.fetched_at || 0) || 0,
      0,
      now,
    ]);
  }
  for (const [key, request] of negativeRequests) {
    statements.push([
      key, null, null, request.title || null, request.artist || null, null,
      0, now + IDENTITY_NEGATIVE_TTL_MS, now,
    ]);
  }
  if (typeof db.batch === 'function') {
    try {
      const prepared = statements.map((bindings) => db.prepare(sql).bind(...bindings));
      await db.batch(prepared);
      return;
    } catch (error) {
      if (missingSchema(error)) return;
      throw error;
    }
  }
  for (const bindings of statements) await safeRun(db, sql, bindings);
}

export async function loadTitleArtistIdentityRows(
  databases,
  tracks,
  limit = 80,
  { canonicalOnly = false } = {},
) {
  const boundedLimit = Math.max(1, Math.trunc(Number(limit) || 80));
  const requests = requestedKeys(tracks, boundedLimit);
  if (!requests.size) return [];

  const sources = (Array.isArray(databases) ? databases : [databases]).filter(Boolean);
  const uniqueSources = [];
  const seen = new Set();
  for (const db of sources) {
    if (!db || seen.has(db)) continue;
    seen.add(db);
    uniqueSources.push(db);
  }

  const now = Date.now();
  const resolved = new Map();
  const pending = new Map();
  for (const [key, request] of requests) {
    const cached = lruGet(key, now);
    if (!cached.hit) pending.set(key, request);
    else if (cached.row) resolved.set(key, cached.row);
  }
  if (!pending.size) return [...resolved.values()];

  // One indexed identity-key query replaces repeated title scans for known rows.
  for (const db of uniqueSources) {
    if (!pending.size) break;
    const rows = await persistentCacheRows(db, pending);
    for (const row of rows) {
      const key = row.title_artist_identity;
      if (!pending.has(key)) continue;
      const unresolvedUntil = Number(row?.unresolved_until || 0);
      if (unresolvedUntil > now) {
        lruSetNegative(key, now);
        pending.delete(key);
        continue;
      }
      const spotifyId = text(row?.spotify_id);
      const isrc = normalizedIsrc(row?.isrc);
      if (!spotifyId && !isrc) continue;
      const resolvedRow = {
        title: pending.get(key)?.title || text(row?.title),
        artist: pending.get(key)?.artist || text(row?.artist),
        spotify_id: spotifyId,
        isrc,
        thumbnail_url: text(row?.thumbnail_url),
        fetched_at: Number(row?.fetched_at || 0) || null,
        title_artist_identity: key,
      };
      resolved.set(key, resolvedRow);
      lruSetPositive(key, resolvedRow, now);
      pending.delete(key);
    }
  }

  const newlyResolved = new Map();
  const blocked = new Set();
  const sourceOrder = canonicalOnly
    ? ['dictionary']
    : ['dictionary', 'metadata', 'tracks', 'isrc'];

  // Probe sources in priority order and carry only genuinely unresolved keys to
  // the next table. Ambiguous identities are blocked instead of being guessed.
  for (const source of sourceOrder) {
    if (!pending.size) break;
    for (const db of uniqueSources) {
      if (!pending.size) break;
      const rows = await sourceRows(db, pending, source);
      const analyzed = analyzeRows(pending, rows);
      for (const [key, row] of analyzed.resolved) {
        resolved.set(key, row);
        newlyResolved.set(key, row);
        lruSetPositive(key, row, now);
        pending.delete(key);
      }
      for (const key of analyzed.blocked) {
        blocked.add(key);
        pending.delete(key);
      }
    }
  }

  if (!canonicalOnly) {
    const negative = new Map();
    for (const key of blocked) {
      const request = requests.get(key);
      if (request) negative.set(key, request);
    }
    for (const [key, request] of pending) negative.set(key, request);
    for (const key of negative.keys()) lruSetNegative(key, now);
    const cacheDb = uniqueSources[0];
    await persistCache(cacheDb, newlyResolved, negative, now);
  } else if (newlyResolved.size) {
    await persistCache(uniqueSources[0], newlyResolved, new Map(), now);
  }

  return [...resolved.values()];
}

export function attachTitleArtistIdentity(tracks, rows = []) {
  if (!Array.isArray(tracks) || !tracks.length || !rows.length) return tracks;
  const byKey = new Map();
  for (const row of rows) {
    const key = row?.title_artist_identity || trackTitleArtistKey(row);
    if (key) byKey.set(key, row);
  }
  let changed = false;
  const result = tracks.map((track) => {
    if (!track || typeof track !== 'object') return track;
    if (text(track.spotify_id) || normalizedIsrc(track.isrc)) return track;
    const row = byKey.get(trackTitleArtistKey(track));
    if (!row) return track;
    const spotifyId = text(row.spotify_id);
    const isrc = normalizedIsrc(row.isrc);
    const thumbnailUrl = text(track.thumbnail_url) || text(row.thumbnail_url);
    if (!spotifyId && !isrc && thumbnailUrl === text(track.thumbnail_url)) return track;
    changed = true;
    return {
      ...track,
      ...(spotifyId ? { spotify_id: spotifyId } : {}),
      ...(isrc ? { isrc } : {}),
      ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
    };
  });
  return changed ? result : tracks;
}
