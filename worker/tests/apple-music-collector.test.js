import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLE_MUSIC_ARTIST_ID,
  APPLE_MUSIC_PAGES_MODEL_KEY,
  APPLE_MUSIC_REGIONS,
  appleMusicBundleUrls,
  appleMusicProbePlan,
  appleMusicTopSongsUrl,
  buildAppleMusicReadModel,
  changedAppleMusicRegions,
  collectAppleMusicSnapshot,
  deriveAppleMusicMeasurement,
  extractAppleMusicWebToken,
  normalizeAppleMusicTopSongs,
  resolveAppleMusicTrackIds,
} from '../src/apple-music-collector.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

class FakeR2 {
  constructor() {
    this.values = new Map();
    this.putCount = 0;
    this.getCount = 0;
  }

  async put(key, value) {
    this.putCount += 1;
    this.values.set(key, String(value));
  }

  async get(key) {
    this.getCount += 1;
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      async json() { return JSON.parse(value); },
      async text() { return value; },
    };
  }
}

class FakeD1 {
  constructor(rows = []) {
    this.rows = new Map(rows.map((row) => [row.isrc, { ...row }]));
    this.aliases = new Map();
    this.nextId = Math.max(0, ...rows.map((row) => Number(row.id) || 0)) + 1;
    this.reads = 0;
    this.writes = 0;
  }

  prepare(sql) {
    const database = this;
    return {
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async all() {
        database.reads += 1;
        if (!sql.includes('FROM sh_tracks')) throw new Error(`unexpected read SQL: ${sql}`);
        const half = Math.floor(this.args.length / 2);
        const isrcs = this.args.slice(0, half || this.args.length);
        const results = [];
        for (const isrc of isrcs) {
          const row = database.rows.get(isrc);
          if (row) results.push({ id: row.id, isrc: row.isrc });
          const aliasId = database.aliases.get(isrc);
          if (aliasId != null) results.push({ id: aliasId, isrc });
        }
        return { results };
      },
      async run() {
        database.writes += 1;
        if (!sql.includes('INSERT OR IGNORE INTO sh_tracks')) throw new Error(`unexpected write SQL: ${sql}`);
        const [, isrc, title, artist, firstSeenAt, lastSeenAt] = this.args;
        if (!database.rows.has(isrc)) {
          database.rows.set(isrc, {
            id: database.nextId++,
            isrc,
            title,
            artist,
            first_seen_at: firstSeenAt,
            last_seen_at: lastSeenAt,
          });
        }
        return { success: true };
      },
    };
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
  }
}

function validIsrc(country, suffix) {
  return `JPAAA26${country.toUpperCase()}${String(suffix).padStart(3, '0')}`;
}

function topSongsPayload(country, { swap = false } = {}) {
  const songs = [
    {
      id: `${country}01`,
      type: 'songs',
      attributes: {
        name: `${country.toUpperCase()} Song A`,
        albumName: `${country.toUpperCase()} Album`,
        artistName: '櫻坂46',
        artwork: { url: `https://example.test/${country}/{w}x{h}.jpg` },
        url: `https://music.apple.com/${country}/song/a`,
        releaseDate: '2026-09-01',
        isrc: validIsrc(country, 1),
      },
    },
    {
      id: `${country}02`,
      type: 'songs',
      attributes: {
        name: `${country.toUpperCase()} Song B`,
        albumName: `${country.toUpperCase()} Album`,
        artistName: '櫻坂46',
        artwork: { url: `https://example.test/${country}/{w}x{h}.jpg` },
        url: `https://music.apple.com/${country}/song/b`,
        releaseDate: '2026-08-01',
        isrc: validIsrc(country, 2),
      },
    },
  ];
  return { data: swap ? songs.reverse() : songs };
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function fakeWebToken(now) {
  return `${base64url({ alg: 'ES256', typ: 'JWT' })}.${base64url({ exp: Math.floor(now / 1000) + 3600, iss: 'apple-web' })}.${'x'.repeat(48)}`;
}

function fakeAppleFetch(now, swaps = new Set(), failures = new Set()) {
  const token = fakeWebToken(now);
  return async (input) => {
    const url = new URL(input);
    if (url.hostname === 'music.apple.com' && url.pathname === '/us/browse') {
      return new Response('<script src="/assets/index-test.js"></script>', { status: 200 });
    }
    if (url.hostname === 'music.apple.com' && url.pathname === '/assets/index-test.js') {
      return new Response(`window.__token="${token}";`, { status: 200 });
    }
    if (url.hostname === 'api.music.apple.com') {
      const country = url.pathname.split('/')[3];
      if (failures.has(country)) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify(topSongsPayload(country, { swap: swaps.has(country) })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

test('Apple Music URL selects the regional top-songs view', () => {
  const top = new URL(appleMusicTopSongsUrl('tw', 12));
  assert.equal(top.origin, 'https://api.music.apple.com');
  assert.equal(top.pathname, `/v1/catalog/tw/artists/${APPLE_MUSIC_ARTIST_ID}/view/top-songs`);
  assert.equal(top.searchParams.get('limit'), '12');
});

test('Apple Music web bootstrap finds the index bundle and a non-expired token', () => {
  const html = '<script src="/assets/chunk.js"></script><script src="/assets/index-abcd.js"></script>';
  assert.deepEqual(appleMusicBundleUrls(html).map((value) => new URL(value).pathname), [
    '/assets/index-abcd.js',
    '/assets/chunk.js',
  ]);
  const now = Date.UTC(2026, 8, 30, 2, 0, 0);
  const token = fakeWebToken(now);
  assert.equal(extractAppleMusicWebToken(`const token="${token}";`, now), token);
  assert.equal(extractAppleMusicWebToken(`const token="${token}";`, now + 2 * 60 * 60_000), null);
});

test('Apple Music normalization keeps Apple id separate from canonical sh_tracks.id', () => {
  const payload = topSongsPayload('jp');
  payload.data.push({
    id: 'jp99',
    attributes: { name: 'ＪＰ Song A', artistName: '櫻坂46', isrc: validIsrc('jp', 99) },
  });
  const tracks = normalizeAppleMusicTopSongs(payload);
  assert.deepEqual(tracks.map(({ rank, title }) => ({ rank, title })), [
    { rank: 1, title: 'JP Song A' },
    { rank: 2, title: 'JP Song B' },
  ]);
  assert.equal(tracks[0].apple_music_id, 'jp01');
  assert.equal(tracks[0].track_id, null);
  assert.equal(tracks[0].song_key, 'jpsonga');
  assert.equal(tracks[0].isrc, validIsrc('jp', 1));
  assert.match(tracks[0].artwork, /300x300/);
});

test('rank change detection compares regional ordering', () => {
  const before = [{ code: 'jp', tracks: normalizeAppleMusicTopSongs(topSongsPayload('jp')) }];
  const same = [{ code: 'jp', tracks: normalizeAppleMusicTopSongs(topSongsPayload('jp')) }];
  const changed = [{ code: 'jp', tracks: normalizeAppleMusicTopSongs(topSongsPayload('jp', { swap: true })) }];
  assert.deepEqual(changedAppleMusicRegions(before, same), []);
  assert.deepEqual(changedAppleMusicRegions(before, changed), ['jp']);
});

test('measurement learns a stable update hour and probes one hour later', () => {
  let measurement = null;
  const regions = APPLE_MUSIC_REGIONS.map(({ code }) => code);
  for (let day = 0; day < 4; day += 1) {
    const at = Date.UTC(2026, 8, 30 + day, 6, 15, 0);
    measurement = deriveAppleMusicMeasurement(measurement, at, regions, false);
  }
  assert.equal(measurement.mode, 'learned');
  assert.equal(measurement.detected_update_hour_jst, 15);
  assert.equal(measurement.recommended_collect_time_jst, '16:15');
  assert.equal(measurement.confidence, 1);

  const model = {
    snapshot_date: '2026-10-02',
    regions: [{ code: 'jp', tracks: [{ rank: 1, apple_music_id: '1' }] }],
    measurement,
  };
  const due = appleMusicProbePlan(model, Date.UTC(2026, 9, 3, 7, 15, 0));
  assert.equal(due.due, true);
  assert.equal(due.reason, 'learned-window');
  const outside = appleMusicProbePlan(model, Date.UTC(2026, 9, 3, 2, 15, 0));
  assert.equal(outside.due, false);
  assert.equal(outside.reason, 'outside-learned-window');
});

test('track resolution caches sh_tracks.id and touches D1 only for unseen ISRCs', async () => {
  const cachedIsrc = validIsrc('jp', 1);
  const existingIsrc = validIsrc('tw', 1);
  const newIsrc = validIsrc('us', 1);
  const db = new FakeD1([{ id: 22, isrc: existingIsrc }]);
  const regions = [{
    code: 'jp',
    tracks: [
      { isrc: cachedIsrc, title: 'Cached', artist: '櫻坂46' },
      { isrc: existingIsrc, title: 'Existing', artist: '櫻坂46' },
      { isrc: newIsrc, title: 'New', artist: '櫻坂46' },
    ],
  }];

  const result = await resolveAppleMusicTrackIds(db, regions, { [cachedIsrc]: 11 }, 1234);
  assert.equal(result.d1_reads, 2);
  assert.equal(result.d1_writes, 1);
  assert.equal(result.tracks_created, 1);
  assert.deepEqual(regions[0].tracks.map((track) => track.track_id), [11, 22, 23]);

  const secondRegions = [{
    code: 'jp',
    tracks: regions[0].tracks.map((track) => ({ ...track, track_id: null })),
  }];
  const second = await resolveAppleMusicTrackIds(db, secondRegions, result.track_ids_by_isrc, 5678);
  assert.equal(second.d1_reads, 0);
  assert.equal(second.d1_writes, 0);
  assert.deepEqual(secondRegions[0].tracks.map((track) => track.track_id), [11, 22, 23]);
});

test('Apple Music read model stores numeric canonical track ids in history', () => {
  const snapshot = {
    version: 2,
    source: 'apple-music-web-top-songs',
    artist_id: APPLE_MUSIC_ARTIST_ID,
    snapshot_date: '2026-09-30',
    observed_at: 123,
    failed_regions: [],
    measurement: { mode: 'calibrating' },
    track_ids_by_isrc: { [validIsrc('jp', 1)]: 101 },
    regions: [{
      code: 'jp',
      label: '日本',
      tracks: [{
        rank: 1,
        song_key: 'song1',
        track_id: 101,
        apple_music_id: 'jp01',
        title: 'Song 1',
      }],
    }],
  };
  const model = buildAppleMusicReadModel(snapshot, { history: [] });
  assert.equal(model.version, 2);
  assert.equal(model.history[0].regions.jp[0].track_id, 101);
  assert.equal(model.history[0].regions.jp[0].apple_music_id, 'jp01');
});

test('hourly collector writes only on changes and reuses R2 track mapping without D1 reads', async () => {
  const r2 = new FakeR2();
  const db = new FakeD1();
  const firstAt = Date.UTC(2026, 8, 30, 2, 15, 0);
  const first = await collectAppleMusicSnapshot(
    { PAGES_RESPONSE_R2: r2, MINUTE_DB: db },
    firstAt,
    fakeAppleFetch(firstAt),
  );
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.ok(first.d1_reads >= 1);
  assert.ok(first.d1_writes >= 1);
  const writesAfterFirst = r2.putCount;
  const d1ReadsAfterFirst = db.reads;
  const d1WritesAfterFirst = db.writes;

  const secondAt = firstAt + 60 * 60_000;
  const second = await collectAppleMusicSnapshot(
    { PAGES_RESPONSE_R2: r2, MINUTE_DB: db },
    secondAt,
    fakeAppleFetch(secondAt),
  );
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.d1_reads, 0);
  assert.equal(second.d1_writes, 0);
  assert.equal(r2.putCount, writesAfterFirst);
  assert.equal(db.reads, d1ReadsAfterFirst);
  assert.equal(db.writes, d1WritesAfterFirst);

  const thirdAt = secondAt + 60 * 60_000;
  const third = await collectAppleMusicSnapshot(
    { PAGES_RESPONSE_R2: r2, MINUTE_DB: db },
    thirdAt,
    fakeAppleFetch(thirdAt, new Set(['jp'])),
  );
  assert.equal(third.ok, true);
  assert.equal(third.changed, true);
  assert.deepEqual(third.changed_regions, ['jp']);
  assert.equal(third.d1_reads, 0);
  assert.equal(third.d1_writes, 0);

  const publicKey = pagesActionsR2ResponseKey(APPLE_MUSIC_PAGES_MODEL_KEY);
  const envelope = JSON.parse(r2.values.get(publicKey));
  const payload = JSON.parse(envelope.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.measurement.change_events.length, 1);
  assert.equal(payload.regions[0].tracks[0].track_id, payload.track_ids_by_isrc[payload.regions[0].tracks[0].isrc]);
});

test('failed storefront keeps its prior ranking while reporting the failure', async () => {
  const r2 = new FakeR2();
  const db = new FakeD1();
  const firstAt = Date.UTC(2026, 8, 30, 2, 15, 0);
  await collectAppleMusicSnapshot(
    { PAGES_RESPONSE_R2: r2, MINUTE_DB: db },
    firstAt,
    fakeAppleFetch(firstAt),
  );
  const nextAt = firstAt + 60 * 60_000;
  const result = await collectAppleMusicSnapshot(
    { PAGES_RESPONSE_R2: r2, MINUTE_DB: db },
    nextAt,
    fakeAppleFetch(nextAt, new Set(['jp']), new Set(['kr'])),
  );
  assert.deepEqual(result.failed_regions, ['kr']);
  const model = JSON.parse(r2.values.get('apple-music/read-model/latest.json'));
  const kr = model.regions.find((region) => region.code === 'kr');
  assert.equal(kr.stale, true);
  assert.equal(kr.tracks.length, 2);
});
