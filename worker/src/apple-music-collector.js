import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const APPLE_MUSIC_ARTIST_ID = '1541126420';
export const APPLE_MUSIC_PAGES_MODEL_KEY = 'apple-music';
export const APPLE_MUSIC_REGIONS = Object.freeze([
  Object.freeze({ code: 'jp', label: '日本' }),
  Object.freeze({ code: 'tw', label: '台湾' }),
  Object.freeze({ code: 'hk', label: '香港' }),
  Object.freeze({ code: 'kr', label: '韓国' }),
  Object.freeze({ code: 'sg', label: 'シンガポール' }),
  Object.freeze({ code: 'th', label: 'タイ' }),
  Object.freeze({ code: 'us', label: '米国' }),
]);

const ARTIST_PREFIX = `apple-music/artist/${APPLE_MUSIC_ARTIST_ID}/`;
const READ_MODEL_KEY = 'apple-music/read-model/latest.json';
const HISTORY_DAYS = 120;
const TOP_SONG_LIMIT = 12;
const APPLE_MUSIC_BOOTSTRAP_URL = 'https://music.apple.com/us/browse';
const CALIBRATION_MIN_DAYS = 4;
const CALIBRATION_MIN_REGION_CHANGES = 12;
const CALIBRATION_CONFIDENCE = 0.6;
const CALIBRATION_MAX_HOURLY_DAYS = 10;
const LEARNED_RETRY_HOURS = 3;
const DIFFUSE_PROBE_INTERVAL_HOURS = 3;
const CHANGE_EVENT_LIMIT = 256;
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function text(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function normalizedIsrc(value) {
  const parsed = text(value)?.toUpperCase().replace(/[-\s]/gu, '') || null;
  return parsed && /^[A-Z0-9]{12}$/u.test(parsed) ? parsed : null;
}

function songKey(value) {
  const title = text(value);
  if (!title) return null;
  return title
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u00a0]+/gu, '')
    .replace(/[‐‑‒–—―−]/gu, '-');
}

function normalizedArtworkUrl(value) {
  const url = text(value);
  if (!url) return null;
  return url.replace('{w}', '300').replace('{h}', '300');
}

function jstParts(now = Date.now()) {
  const date = new Date(Number(now) + 9 * 60 * 60_000);
  return {
    date: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

export function appleMusicJstDate(now = Date.now()) {
  return jstParts(now).date;
}

export function appleMusicTopSongsUrl(regionCode, limit = TOP_SONG_LIMIT) {
  const code = String(regionCode || 'jp').toLowerCase();
  const url = new URL(`https://api.music.apple.com/v1/catalog/${code}/artists/${APPLE_MUSIC_ARTIST_ID}/view/top-songs`);
  url.searchParams.set('limit', String(Math.max(1, Math.min(25, Number(limit) || TOP_SONG_LIMIT))));
  return url.toString();
}

export function appleMusicBundleUrls(html) {
  const urls = [];
  const seen = new Set();
  const source = String(html || '');
  const regex = /<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/giu;
  for (const match of source.matchAll(regex)) {
    try {
      const url = new URL(match[1], 'https://music.apple.com').toString();
      if (!url.startsWith('https://music.apple.com/')) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    } catch {
      // Ignore malformed script URLs.
    }
  }
  return urls.sort((a, b) => {
    const aIndex = /\/assets\/index[-.]/u.test(a) ? 0 : 1;
    const bIndex = /\/assets\/index[-.]/u.test(b) ? 0 : 1;
    return aIndex - bIndex;
  });
}

function jwtExpiryMs(token) {
  try {
    if (typeof atob !== 'function') return Number.POSITIVE_INFINITY;
    const payload = String(token || '').split('.')[1];
    if (!payload) return 0;
    const padded = payload.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded));
    return Number(decoded?.exp) * 1000;
  } catch {
    return 0;
  }
}

export function extractAppleMusicWebToken(source, now = Date.now()) {
  const tokens = String(source || '').match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu) || [];
  return tokens.find((token) => jwtExpiryMs(token) > Number(now) + 60_000) || null;
}

export async function fetchAppleMusicWebToken(fetchImpl = fetch, now = Date.now()) {
  const bootstrap = await fetchImpl(APPLE_MUSIC_BOOTSTRAP_URL, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
    },
  });
  if (!bootstrap?.ok) throw new Error(`Apple Music bootstrap HTTP ${bootstrap?.status || 0}`);
  const html = await bootstrap.text();
  const inlineToken = extractAppleMusicWebToken(html, now);
  if (inlineToken) return inlineToken;

  const bundleUrls = appleMusicBundleUrls(html).slice(0, 8);
  if (!bundleUrls.length) throw new Error('Apple Music web bundle URL was not found');
  for (const url of bundleUrls) {
    const response = await fetchImpl(url, {
      headers: {
        accept: '*/*',
        referer: 'https://music.apple.com/',
        'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
      },
    });
    if (!response?.ok) continue;
    const token = extractAppleMusicWebToken(await response.text(), now);
    if (token) return token;
  }
  throw new Error('Apple Music web token was not found');
}

function pushUniqueTrack(tracks, seen, track) {
  const key = songKey(track?.title);
  if (!key || seen.has(key)) return;
  seen.add(key);
  tracks.push({ ...track, song_key: key, rank: tracks.length + 1 });
}

export function normalizeAppleMusicTopSongs(payload) {
  const seen = new Set();
  const tracks = [];
  for (const item of Array.isArray(payload?.data) ? payload.data : []) {
    const attributes = item?.attributes || {};
    if (!attributes?.name) continue;
    pushUniqueTrack(tracks, seen, {
      apple_music_id: text(item?.id),
      track_id: null,
      title: text(attributes.name),
      album: text(attributes.albumName),
      artist: text(attributes.artistName),
      artwork: normalizedArtworkUrl(attributes?.artwork?.url),
      url: text(attributes.url),
      release_date: text(attributes.releaseDate),
      isrc: normalizedIsrc(attributes.isrc),
    });
  }
  return tracks.slice(0, TOP_SONG_LIMIT);
}

async function fetchAppleMusicTopSongs(region, token, fetchImpl) {
  if (!token) throw new Error('Apple Music web token unavailable');
  const response = await fetchImpl(appleMusicTopSongsUrl(region.code), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      origin: 'https://music.apple.com',
      referer: `https://music.apple.com/${region.code}/artist/-/${APPLE_MUSIC_ARTIST_ID}`,
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
    },
  });
  if (!response?.ok) throw new Error(`Apple Music ${region.code} top-songs HTTP ${response?.status || 0}`);
  const tracks = normalizeAppleMusicTopSongs(await response.json());
  if (!tracks.length) throw new Error(`Apple Music ${region.code} top-songs returned no tracks`);
  return tracks;
}

export async function fetchAppleMusicRegion(region, { token, fetchImpl = fetch } = {}) {
  return {
    code: region.code,
    label: region.label,
    source: 'apple-music-web-top-songs',
    tracks: await fetchAppleMusicTopSongs(region, token, fetchImpl),
  };
}

async function getJson(r2, key) {
  if (typeof r2?.get !== 'function') return null;
  const object = await r2.get(key);
  if (!object) return null;
  try {
    if (typeof object.json === 'function') return await object.json();
    if (typeof object.text === 'function') return JSON.parse(await object.text());
  } catch {
    return null;
  }
  return null;
}

async function putJson(r2, key, value, metadata = {}) {
  const body = JSON.stringify(value);
  await r2.put(key, body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: Object.fromEntries(Object.entries(metadata).map(([name, item]) => [name, String(item)])),
  });
  return body.length;
}

function trackIdentityKey(track) {
  const appleId = text(track?.apple_music_id);
  if (appleId) return `apple:${appleId}`;
  // Compatibility with the first Apple Music model where track_id contained the Apple catalog id.
  if (typeof track?.track_id === 'string' && track.track_id) return `apple:${track.track_id}`;
  const isrc = normalizedIsrc(track?.isrc);
  if (isrc) return `isrc:${isrc}`;
  return track?.song_key ? `title:${track.song_key}` : null;
}

function regionSignature(region) {
  return (Array.isArray(region?.tracks) ? region.tracks : [])
    .slice(0, TOP_SONG_LIMIT)
    .map((track) => `${Number(track?.rank) || 0}:${trackIdentityKey(track) || ''}`)
    .join('|');
}

function regionMap(regions) {
  return new Map((Array.isArray(regions) ? regions : []).map((region) => [region.code, region]));
}

export function changedAppleMusicRegions(previousRegions, nextRegions) {
  const previous = regionMap(previousRegions);
  return (Array.isArray(nextRegions) ? nextRegions : [])
    .filter((region) => regionSignature(previous.get(region.code)) !== regionSignature(region))
    .map((region) => region.code);
}

function hasLegacyTrackIds(model) {
  for (const region of Array.isArray(model?.regions) ? model.regions : []) {
    for (const track of Array.isArray(region?.tracks) ? region.tracks : []) {
      if (track?.apple_music_id == null || (track?.track_id != null && !Number.isSafeInteger(Number(track.track_id)))) return true;
    }
  }
  return false;
}

function measurementEvents(value) {
  return (Array.isArray(value) ? value : [])
    .filter((event) => Number.isFinite(Number(event?.observed_at)) && /^\d{4}-\d{2}-\d{2}$/u.test(String(event?.jst_date || '')))
    .slice(-CHANGE_EVENT_LIMIT);
}

function measurementHistogram(events) {
  const histogram = Array.from({ length: 24 }, () => 0);
  let total = 0;
  for (const event of events) {
    const hour = Number(event?.jst_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const weight = Math.max(1, Array.isArray(event?.regions) ? event.regions.length : 1);
    histogram[hour] += weight;
    total += weight;
  }
  let bestHour = null;
  let bestCount = 0;
  histogram.forEach((count, hour) => {
    if (count > bestCount) {
      bestHour = hour;
      bestCount = count;
    }
  });
  return {
    histogram,
    total,
    best_hour: bestHour,
    confidence: total > 0 ? bestCount / total : 0,
  };
}

export function deriveAppleMusicMeasurement(previousMeasurement, now = Date.now(), changedRegions = [], baseline = false) {
  const observedAt = Number(now) || Date.now();
  const parts = jstParts(observedAt);
  const previous = previousMeasurement && typeof previousMeasurement === 'object' ? previousMeasurement : {};
  const startedAt = Number(previous.started_at) || observedAt;
  const events = measurementEvents(previous.change_events);

  if (!baseline && changedRegions.length) {
    events.push({
      observed_at: observedAt,
      jst_date: parts.date,
      jst_hour: parts.hour,
      jst_minute: parts.minute,
      regions: [...new Set(changedRegions)].sort(),
    });
  }

  const boundedEvents = events.slice(-CHANGE_EVENT_LIMIT);
  const distinctDays = new Set(boundedEvents.map((event) => event.jst_date)).size;
  const ageDays = Math.max(1, Math.floor((observedAt - startedAt) / 86_400_000) + 1);
  const distribution = measurementHistogram(boundedEvents);
  const learned = distinctDays >= CALIBRATION_MIN_DAYS
    && distribution.total >= CALIBRATION_MIN_REGION_CHANGES
    && distribution.best_hour != null
    && distribution.confidence >= CALIBRATION_CONFIDENCE;

  let mode = 'calibrating';
  if (learned) mode = 'learned';
  else if (ageDays > CALIBRATION_MAX_HOURLY_DAYS) mode = 'diffuse';

  const detectedHour = learned ? distribution.best_hour : null;
  const recommendedHour = detectedHour == null ? null : (detectedHour + 1) % 24;

  return {
    version: 1,
    mode,
    started_at: startedAt,
    age_days: ageDays,
    change_days: distinctDays,
    region_change_samples: distribution.total,
    confidence: Number(distribution.confidence.toFixed(3)),
    detected_update_hour_jst: detectedHour,
    recommended_collect_hour_jst: recommendedHour,
    recommended_collect_time_jst: recommendedHour == null ? null : `${String(recommendedHour).padStart(2, '0')}:15`,
    last_change_at: boundedEvents.at(-1)?.observed_at ?? previous.last_change_at ?? null,
    change_events: boundedEvents,
  };
}

export function appleMusicProbePlan(model, now = Date.now()) {
  if (!model?.regions?.length) {
    return { due: true, reason: 'bootstrap', measurement: deriveAppleMusicMeasurement(model?.measurement, now, [], true) };
  }

  const measurement = deriveAppleMusicMeasurement(model?.measurement, now);
  const { date, hour } = jstParts(now);
  if (measurement.mode === 'calibrating') {
    return { due: true, reason: 'hourly-calibration', measurement };
  }
  if (measurement.mode === 'diffuse') {
    return {
      due: hour % DIFFUSE_PROBE_INTERVAL_HOURS === 0,
      reason: hour % DIFFUSE_PROBE_INTERVAL_HOURS === 0 ? 'diffuse-probe' : 'diffuse-skip',
      measurement,
    };
  }

  const recommendedHour = Number(measurement.recommended_collect_hour_jst);
  const latestDate = String(model?.snapshot_date || '');
  if (latestDate === date) {
    return { due: false, reason: 'already-updated-today', measurement };
  }
  const dueHours = Array.from({ length: LEARNED_RETRY_HOURS }, (_, offset) => (recommendedHour + offset) % 24);
  const due = dueHours.includes(hour);
  return { due, reason: due ? 'learned-window' : 'outside-learned-window', measurement };
}

function uniqueTracksByIsrc(regions) {
  const byIsrc = new Map();
  for (const region of Array.isArray(regions) ? regions : []) {
    for (const track of Array.isArray(region?.tracks) ? region.tracks : []) {
      const isrc = normalizedIsrc(track?.isrc);
      if (isrc && !byIsrc.has(isrc)) byIsrc.set(isrc, track);
    }
  }
  return byIsrc;
}

async function selectTrackIdsByIsrc(db, isrcs) {
  if (!isrcs.length) return new Map();
  const placeholders = isrcs.map(() => '?').join(',');
  const result = await db.prepare(`SELECT id,isrc FROM sh_tracks WHERE isrc IN (${placeholders})
      UNION ALL
      SELECT track_id AS id,alias_value AS isrc FROM sh_track_aliases
      WHERE alias_type='isrc' AND alias_value IN (${placeholders})`)
    .bind(...isrcs, ...isrcs)
    .all();
  const found = new Map();
  for (const row of result.results || []) {
    const isrc = normalizedIsrc(row?.isrc);
    const id = Number(row?.id);
    if (isrc && Number.isSafeInteger(id) && !found.has(isrc)) found.set(isrc, id);
  }
  return found;
}

export async function resolveAppleMusicTrackIds(db, regions, previousMap = {}, observedAt = Date.now()) {
  const cached = new Map();
  for (const [isrcValue, idValue] of Object.entries(previousMap || {})) {
    const isrc = normalizedIsrc(isrcValue);
    const id = Number(idValue);
    if (isrc && Number.isSafeInteger(id)) cached.set(isrc, id);
  }

  const tracksByIsrc = uniqueTracksByIsrc(regions);
  const unresolved = [...tracksByIsrc.keys()].filter((isrc) => !cached.has(isrc));
  let reads = 0;
  let writes = 0;
  let created = 0;

  if (unresolved.length && db?.prepare) {
    const existing = await selectTrackIdsByIsrc(db, unresolved);
    reads += 1;
    for (const [isrc, id] of existing) cached.set(isrc, id);

    const missing = unresolved.filter((isrc) => !cached.has(isrc));
    if (missing.length) {
      const statements = missing.map((isrc) => {
        const track = tracksByIsrc.get(isrc);
        return db.prepare(`INSERT OR IGNORE INTO sh_tracks(
            canonical_key,isrc,spotify_id,stationhead_track_id,title,artist,first_seen_at,last_seen_at
          ) VALUES(?,?,NULL,NULL,?,?,?,?)`)
          .bind(`isrc:${isrc}`, isrc, text(track?.title), text(track?.artist), observedAt, observedAt);
      });
      if (typeof db.batch === 'function') await db.batch(statements);
      else for (const statement of statements) await statement.run();
      writes += statements.length;
      const inserted = await selectTrackIdsByIsrc(db, missing);
      reads += 1;
      created += inserted.size;
      for (const [isrc, id] of inserted) cached.set(isrc, id);
    }
  }

  for (const region of Array.isArray(regions) ? regions : []) {
    for (const track of Array.isArray(region?.tracks) ? region.tracks : []) {
      const isrc = normalizedIsrc(track?.isrc);
      track.isrc = isrc;
      track.track_id = isrc ? cached.get(isrc) ?? null : null;
    }
  }

  return {
    track_ids_by_isrc: Object.fromEntries([...cached.entries()].sort(([a], [b]) => a.localeCompare(b))),
    d1_reads: reads,
    d1_writes: writes,
    tracks_created: created,
    unresolved_tracks: [...tracksByIsrc.keys()].filter((isrc) => !cached.has(isrc)),
  };
}

function carryFailedRegions(fetchedRegions, previousRegions, failedRegions) {
  const fetched = regionMap(fetchedRegions);
  const previous = regionMap(previousRegions);
  const failedCodes = new Set((failedRegions || []).map((item) => item.code));
  return APPLE_MUSIC_REGIONS.flatMap((definition) => {
    if (fetched.has(definition.code)) return [fetched.get(definition.code)];
    if (failedCodes.has(definition.code) && previous.has(definition.code)) {
      return [{ ...previous.get(definition.code), stale: true }];
    }
    return [];
  });
}

function historyPoint(snapshot) {
  return {
    snapshot_date: snapshot.snapshot_date,
    observed_at: snapshot.observed_at,
    regions: Object.fromEntries(snapshot.regions.map((region) => [
      region.code,
      region.tracks.slice(0, TOP_SONG_LIMIT).map((track) => ({
        song_key: track.song_key,
        track_id: Number.isSafeInteger(Number(track.track_id)) ? Number(track.track_id) : null,
        apple_music_id: text(track.apple_music_id),
        rank: track.rank,
      })),
    ])),
  };
}

export function buildAppleMusicReadModel(snapshot, previousModel = null) {
  const previousHistory = Array.isArray(previousModel?.history) ? previousModel.history : [];
  const history = previousHistory
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/u.test(String(point?.snapshot_date || '')))
    .filter((point) => point.snapshot_date !== snapshot.snapshot_date);
  history.push(historyPoint(snapshot));
  history.sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));

  return {
    version: 2,
    source: snapshot.source,
    artist_id: snapshot.artist_id,
    artist_name: '櫻坂46',
    snapshot_date: snapshot.snapshot_date,
    observed_at: snapshot.observed_at,
    regions: snapshot.regions,
    failed_regions: snapshot.failed_regions,
    measurement: snapshot.measurement,
    track_ids_by_isrc: snapshot.track_ids_by_isrc || previousModel?.track_ids_by_isrc || {},
    history: history.slice(-HISTORY_DAYS),
  };
}

async function publishReadModel(r2, model, observedAt) {
  const body = JSON.stringify({ ok: true, ...model });
  const objectKey = pagesActionsR2ResponseKey(APPLE_MUSIC_PAGES_MODEL_KEY);
  if (!objectKey) throw new Error('Apple Music public read-model key is unavailable');
  const envelope = {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: observedAt,
    cadence_seconds: 0,
    source_revision: `apple-music:${model.snapshot_date}:${observedAt}`,
    renderer_revision: 'apple-music-v2',
    body,
  };
  await r2.put(objectKey, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return { objectKey, bytes: body.length };
}

async function persistModel(r2, model, observedAt, { writeSnapshot = true } = {}) {
  let bytesWritten = 0;
  if (writeSnapshot) {
    bytesWritten += await putJson(r2, `${ARTIST_PREFIX}daily/${model.snapshot_date}.json`, model, {
      snapshotDate: model.snapshot_date,
      observedAt,
    });
    bytesWritten += await putJson(r2, `${ARTIST_PREFIX}latest.json`, model, {
      snapshotDate: model.snapshot_date,
      observedAt,
    });
  }
  bytesWritten += await putJson(r2, READ_MODEL_KEY, model, {
    snapshotDate: model.snapshot_date,
    observedAt,
  });
  const published = await publishReadModel(r2, model, observedAt);
  bytesWritten += published.bytes;
  return { bytesWritten, objectKey: published.objectKey };
}

export async function collectAppleMusicSnapshot(env, now = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.put !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is required');

  const observedAt = Number(now) || Date.now();
  const previousModel = await getJson(r2, READ_MODEL_KEY);
  const plan = appleMusicProbePlan(previousModel, observedAt);
  if (!plan.due) {
    return {
      ok: true,
      skipped: true,
      reason: plan.reason,
      measurement: plan.measurement,
      d1_reads: 0,
      d1_writes: 0,
      bytes_written: 0,
    };
  }

  const token = await fetchAppleMusicWebToken(fetchImpl, observedAt);
  const settled = await Promise.allSettled(
    APPLE_MUSIC_REGIONS.map((region) => fetchAppleMusicRegion(region, { token, fetchImpl })),
  );

  const fetchedRegions = [];
  const failedRegions = [];
  settled.forEach((result, index) => {
    const region = APPLE_MUSIC_REGIONS[index];
    if (result.status === 'fulfilled') fetchedRegions.push(result.value);
    else failedRegions.push({
      code: region.code,
      label: region.label,
      error: String(result.reason?.message || result.reason || 'unknown error').slice(0, 240),
    });
  });
  if (!fetchedRegions.length) throw new Error('Apple Music collection failed for every region');

  const baseline = !(Array.isArray(previousModel?.regions) && previousModel.regions.length);
  const changedRegions = baseline ? [] : changedAppleMusicRegions(previousModel.regions, fetchedRegions);
  const migrationRequired = hasLegacyTrackIds(previousModel);
  const rankingChanged = baseline || changedRegions.length > 0;

  if (!rankingChanged && !migrationRequired) {
    const measurement = deriveAppleMusicMeasurement(previousModel?.measurement, observedAt);
    const modeChanged = measurement.mode !== previousModel?.measurement?.mode
      || measurement.recommended_collect_time_jst !== previousModel?.measurement?.recommended_collect_time_jst;
    if (modeChanged) {
      const model = { ...previousModel, measurement };
      const persisted = await persistModel(r2, model, observedAt, { writeSnapshot: false });
      return {
        ok: true,
        changed: false,
        schedule_updated: true,
        measurement,
        regions: fetchedRegions.length,
        failed_regions: failedRegions.map((item) => item.code),
        d1_reads: 0,
        d1_writes: 0,
        bytes_written: persisted.bytesWritten,
        pages_object_key: persisted.objectKey,
      };
    }
    return {
      ok: true,
      changed: false,
      schedule_updated: false,
      measurement,
      regions: fetchedRegions.length,
      failed_regions: failedRegions.map((item) => item.code),
      d1_reads: 0,
      d1_writes: 0,
      bytes_written: 0,
    };
  }

  const resolution = await resolveAppleMusicTrackIds(
    env?.MINUTE_DB,
    fetchedRegions,
    previousModel?.track_ids_by_isrc,
    observedAt,
  );
  const regions = carryFailedRegions(fetchedRegions, previousModel?.regions, failedRegions);
  const snapshotDate = rankingChanged ? appleMusicJstDate(observedAt) : previousModel.snapshot_date;
  const measurement = deriveAppleMusicMeasurement(
    previousModel?.measurement,
    observedAt,
    changedRegions,
    baseline,
  );

  const snapshot = {
    version: 2,
    source: 'apple-music-web-top-songs',
    artist_id: APPLE_MUSIC_ARTIST_ID,
    artist_name: '櫻坂46',
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    regions,
    failed_regions: failedRegions,
    measurement,
    track_ids_by_isrc: resolution.track_ids_by_isrc,
  };

  const model = buildAppleMusicReadModel(snapshot, previousModel);
  const persisted = await persistModel(r2, model, observedAt, { writeSnapshot: true });

  return {
    ok: true,
    changed: rankingChanged,
    migrated_track_ids: migrationRequired,
    changed_regions: changedRegions,
    snapshot_date: snapshotDate,
    source: snapshot.source,
    regions: regions.length,
    failed_regions: failedRegions.map((item) => item.code),
    measurement,
    d1_reads: resolution.d1_reads,
    d1_writes: resolution.d1_writes,
    tracks_created: resolution.tracks_created,
    unresolved_tracks: resolution.unresolved_tracks,
    bytes_written: persisted.bytesWritten,
    pages_object_key: persisted.objectKey,
  };
}
