const REFRESH_MS = 24 * 60 * 60_000;
const BATCH_SIZE = 40;
const APPLE_MODEL_KEY = 'apple-music/read-model/latest.json';
const AMAZON_MODEL_KEY = 'amazon-music/read-model/latest.json';
const AMAZON_OTHER_TABLES = Object.freeze([
  'amazon_music_chart_change_events',
  'amazon_music_group_rank_history',
]);

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function integer(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function chunks(values, size = BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
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

async function runBatches(db, statements) {
  if (!db?.prepare || !statements.length) return;
  for (const part of chunks(statements)) {
    if (typeof db.batch === 'function') await db.batch(part);
    else for (const statement of part) await statement.run();
  }
}

export async function persistMusicServiceTrackRefs(db, service, tracks, observedAt = Date.now()) {
  if (!db?.prepare) return 0;
  const now = Number(observedAt) || Date.now();
  const unique = new Map();
  for (const track of tracks || []) {
    const sourceTrackId = text(track?.source_track_id);
    const trackId = integer(track?.track_id);
    if (!sourceTrackId || trackId == null) continue;
    unique.set(sourceTrackId, trackId);
  }
  const statements = [...unique].map(([sourceTrackId, trackId]) => db.prepare(`INSERT INTO music_service_track_refs(
      service,source_track_id,track_id,first_seen_at,last_seen_at
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(service,source_track_id) DO UPDATE SET
      track_id=excluded.track_id,
      last_seen_at=excluded.last_seen_at
    WHERE music_service_track_refs.track_id<>excluded.track_id
       OR music_service_track_refs.last_seen_at<=excluded.last_seen_at-?`)
    .bind(service, sourceTrackId, trackId, now, now, REFRESH_MS));
  await runBatches(db, statements);
  return statements.length;
}

function appleArtistModels(model) {
  const artists = Array.isArray(model?.artists) ? model.artists.filter(Boolean) : [];
  if (artists.length) return artists;
  return [{
    key: 'sakurazaka46',
    artist_key: 'sakurazaka46',
    artist_name: text(model?.artist_name) || '櫻坂46',
    snapshot_date: model?.snapshot_date || null,
    observed_at: model?.observed_at || null,
    regions: Array.isArray(model?.regions) ? model.regions : [],
  }];
}

function latestAppleSnapshotDate(model) {
  const dates = appleArtistModels(model)
    .map((artist) => text(artist?.snapshot_date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date));
  return dates.sort().at(-1) || text(model?.snapshot_date);
}

function latestAppleObservedAt(model, fallback) {
  const values = [
    Number(model?.observed_at),
    ...appleArtistModels(model).map((artist) => Number(artist?.observed_at)),
    Number(fallback),
  ].filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : Date.now();
}

function appleCurrentRows(model) {
  const refs = [];
  const byRegion = new Map();
  for (const artistModel of appleArtistModels(model)) {
    const artistKey = text(artistModel?.key || artistModel?.artist_key) || 'sakurazaka46';
    for (const region of Array.isArray(artistModel?.regions) ? artistModel.regions : []) {
      const code = text(region?.code);
      if (!code) continue;
      if (!byRegion.has(code)) byRegion.set(code, []);
      const ranks = byRegion.get(code);
      for (const track of Array.isArray(region?.tracks) ? region.tracks : []) {
        const trackId = integer(track?.track_id);
        const appleId = text(track?.apple_music_id);
        const rank = integer(track?.rank);
        if (trackId == null || rank == null) continue;
        ranks.push({ artist_key: artistKey, track_id: trackId, rank });
        if (appleId) refs.push({ source_track_id: appleId, track_id: trackId });
      }
    }
  }
  const snapshots = [...byRegion]
    .map(([regionCode, ranks]) => ({
      region_code: regionCode,
      ranks: ranks.sort((a, b) => String(a.artist_key).localeCompare(String(b.artist_key)) || a.rank - b.rank),
    }))
    .sort((a, b) => a.region_code.localeCompare(b.region_code));
  return { refs, snapshots };
}

export async function persistAppleMusicModelToOther(env, observedAt = Date.now()) {
  const db = env?.OTHER_DB;
  if (!db?.prepare) return { persisted: false, reason: 'other-db-missing' };
  const model = await getJson(env?.PAGES_RESPONSE_R2, APPLE_MODEL_KEY);
  const snapshotDate = latestAppleSnapshotDate(model);
  if (!snapshotDate) return { persisted: false, reason: 'model-missing' };
  const now = latestAppleObservedAt(model, observedAt);
  const { refs, snapshots } = appleCurrentRows(model);
  await persistMusicServiceTrackRefs(db, 'apple_music', refs, now);
  const statements = snapshots.map((snapshot) => db.prepare(`INSERT INTO apple_music_rank_snapshots(
      snapshot_date,region_code,observed_at,ranks_json
    ) VALUES(?,?,?,?)
    ON CONFLICT(snapshot_date,region_code) DO UPDATE SET
      observed_at=excluded.observed_at,ranks_json=excluded.ranks_json
    WHERE apple_music_rank_snapshots.ranks_json<>excluded.ranks_json
       OR apple_music_rank_snapshots.observed_at<excluded.observed_at`)
    .bind(snapshotDate, snapshot.region_code, now, JSON.stringify(snapshot.ranks)));
  await runBatches(db, statements);
  return { persisted: true, refs: refs.length, snapshots: statements.length, snapshot_date: snapshotDate };
}

function amazonCurrentRows(model) {
  const refs = [];
  const ranks = [];
  for (const track of Array.isArray(model?.tracks) ? model.tracks : []) {
    const trackId = integer(track?.track_id);
    const amazonId = text(track?.amazon_music_id);
    const rank = integer(track?.amazon_rank);
    if (amazonId && trackId != null) refs.push({ source_track_id: amazonId, track_id: trackId });
    // Amazon Music can expose multiple catalog-track IDs for the same canonical
    // song (for example standard and Special Edition releases). Ranking facts
    // therefore keep the provider identity and use sh_tracks.id only as the
    // canonical-song foreign key. Unresolved provider tracks are retained too.
    if (amazonId && rank != null) {
      ranks.push({ source_track_id: amazonId, track_id: trackId, rank });
    }
  }
  ranks.sort((a, b) => a.rank - b.rank
    || String(a.source_track_id).localeCompare(String(b.source_track_id)));
  return { refs, ranks };
}

export async function persistAmazonMusicModelToOther(env, observedAt = Date.now()) {
  const db = env?.OTHER_DB;
  if (!db?.prepare) return { persisted: false, reason: 'other-db-missing' };
  const model = await getJson(env?.PAGES_RESPONSE_R2, AMAZON_MODEL_KEY);
  const snapshotDate = text(model?.snapshot_date);
  if (!snapshotDate) return { persisted: false, reason: 'model-missing' };
  if (model?.scan && model.scan.complete === false) {
    return { persisted: false, reason: 'scan-incomplete' };
  }
  const now = Number(model?.observed_at) || Number(observedAt) || Date.now();
  const { refs, ranks } = amazonCurrentRows(model);
  await persistMusicServiceTrackRefs(db, 'amazon_music', refs, now);
  await db.prepare(`INSERT INTO amazon_music_rank_snapshots(
      snapshot_date,observed_at,ranks_json
    ) VALUES(?,?,?)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      observed_at=excluded.observed_at,ranks_json=excluded.ranks_json
    WHERE amazon_music_rank_snapshots.ranks_json<>excluded.ranks_json
       OR amazon_music_rank_snapshots.observed_at<excluded.observed_at`)
    .bind(snapshotDate, now, JSON.stringify(ranks))
    .run();
  return { persisted: true, refs: refs.length, ranked_tracks: ranks.length };
}

function amazonOtherSql(sql) {
  const value = String(sql || '').toLowerCase();
  return AMAZON_OTHER_TABLES.some((table) => value.includes(table));
}

function wrapStatement(statement, target) {
  if (!statement) return statement;
  const wrapped = {
    __music_service_target: target,
    __music_service_statement: statement,
    bind(...values) {
      return wrapStatement(statement.bind(...values), target);
    },
  };
  for (const method of ['all', 'first', 'run', 'raw']) {
    if (typeof statement?.[method] === 'function') {
      wrapped[method] = (...args) => statement[method](...args);
    }
  }
  return wrapped;
}

export function createAmazonMusicDbRouter(minuteDb, otherDb) {
  if (!minuteDb?.prepare) return minuteDb;
  if (!otherDb?.prepare) return minuteDb;
  return {
    prepare(sql) {
      const target = amazonOtherSql(sql) ? 'other' : 'minute';
      const db = target === 'other' ? otherDb : minuteDb;
      return wrapStatement(db.prepare(sql), target);
    },
    async batch(statements) {
      const indexed = (statements || []).map((statement, index) => ({
        index,
        target: statement?.__music_service_target || 'minute',
        statement: statement?.__music_service_statement || statement,
      }));
      const results = new Array(indexed.length);
      for (const target of ['minute', 'other']) {
        const group = indexed.filter((item) => item.target === target);
        if (!group.length) continue;
        const db = target === 'other' ? otherDb : minuteDb;
        if (typeof db.batch === 'function') {
          const batchResults = await db.batch(group.map((item) => item.statement));
          group.forEach((item, offset) => { results[item.index] = batchResults?.[offset]; });
        } else {
          for (const item of group) results[item.index] = await item.statement.run();
        }
      }
      return results;
    },
  };
}

export function amazonMusicServiceEnv(env) {
  if (!env) return env;
  return {
    ...env,
    MINUTE_DB: createAmazonMusicDbRouter(env.MINUTE_DB, env.OTHER_DB),
  };
}
