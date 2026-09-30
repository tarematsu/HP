import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAmazonMusicTracks } from '../src/amazon-music-track-identity.js';
import { buildTrackDescriptor } from '../src/minute-facts-track-descriptor.js';

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = String(sql);
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.db, this.sql, bindings);
  }

  async all() {
    if (this.sql.includes('FROM sh_tracks WHERE id IN')) {
      const wanted = new Set(this.bindings.map(Number));
      return { results: this.db.trackRows.filter((row) => wanted.has(Number(row.id))) };
    }
    if (this.sql.includes('FROM sh_tracks') && this.sql.includes('TRIM(title)')) {
      this.db.maxTitleBindings = Math.max(this.db.maxTitleBindings, this.bindings.length);
      if (this.bindings.length > 100) throw new Error('D1_ERROR: too many SQL variables');
      const wanted = new Set(this.bindings.map((value) => String(value).trim().toLowerCase()));
      return {
        results: this.db.trackRows.filter((row) => wanted.has(String(row.title || '').trim().toLowerCase())),
      };
    }
    if (!this.sql.includes('FROM sh_track_aliases')) return { results: [] };
    const results = [];
    if (this.sql.includes("alias_type='amazon_music_id'")) {
      for (const value of this.bindings) {
        const trackId = this.db.aliases.get(`amazon_music_id:${String(value)}`);
        if (trackId != null) results.push({ alias_value: String(value), track_id: trackId });
      }
      return { results };
    }
    const aliasType = String(this.bindings[0]);
    for (const value of this.bindings.slice(1)) {
      const trackId = this.db.aliases.get(`${aliasType}:${String(value)}`);
      if (trackId != null) {
        results.push({ alias_type: aliasType, alias_value: String(value), track_id: trackId });
      }
    }
    return { results };
  }
}

class FakeDb {
  constructor(entries = [], trackRows = []) {
    this.aliases = new Map(entries);
    this.trackRows = trackRows;
    this.trackInserts = 0;
    this.maxTitleBindings = 0;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements = []) {
    for (const statement of statements) {
      if (statement.sql.includes('INSERT OR IGNORE INTO sh_tracks')) {
        this.trackInserts += 1;
      }
      if (statement.sql.includes('UPDATE sh_track_aliases SET')) {
        const [trackId, , aliasValue] = statement.bindings;
        this.aliases.set(`amazon_music_id:${String(aliasValue)}`, Number(trackId));
        continue;
      }
      if (!statement.sql.includes('INSERT INTO sh_track_aliases')) continue;
      const [aliasType, aliasValue, trackId] = statement.bindings;
      const key = `${String(aliasType)}:${String(aliasValue)}`;
      const existing = this.aliases.get(key);
      if (existing == null || Number(existing) === Number(trackId)) {
        this.aliases.set(key, Number(trackId));
      }
    }
    return [];
  }
}

test('Amazon Music id is an alias while ISRC remains the canonical identity', () => {
  const descriptor = buildTrackDescriptor({
    isrc: 'jptest000001',
    amazonTrackId: 'B0AMAZON001',
  });
  assert.equal(descriptor.canonicalKey, 'isrc:JPTEST000001');
  assert.deepEqual(descriptor.aliases, [
    { type: 'isrc', value: 'JPTEST000001' },
    { type: 'amazon_music_id', value: 'B0AMAZON001' },
  ]);
  assert.equal(descriptor.amazon_music_id, 'B0AMAZON001');
});

test('Amazon Music id alone never creates a new canonical song', () => {
  const descriptor = buildTrackDescriptor({ amazon_music_id: 'B0AMAZON002' });
  assert.equal(descriptor.canonicalKey, null);
  assert.deepEqual(descriptor.aliases, [
    { type: 'amazon_music_id', value: 'B0AMAZON002' },
  ]);
});

test('first Amazon observation links to the existing ISRC track and persists one alias', async () => {
  const db = new FakeDb([['isrc:JPTEST000003', 42]]);
  const [resolved] = await resolveAmazonMusicTracks(db, [{
    amazon_music_id: 'B0AMAZON003',
    isrc: 'jptest000003',
    title: 'duplicated metadata must not be persisted by Amazon identity input',
  }], 10_000);

  assert.equal(resolved.trackId, 42);
  assert.equal(resolved.amazon_music_id, 'B0AMAZON003');
  assert.equal(db.aliases.get('amazon_music_id:B0AMAZON003'), 42);
  assert.equal(db.trackInserts, 0);
});

test('known Amazon alias resolves without ISRC and unknown alias stays unresolved without writes', async () => {
  const db = new FakeDb([['amazon_music_id:B0KNOWN', 77]]);
  const resolved = await resolveAmazonMusicTracks(db, [
    { amazon_music_id: 'B0KNOWN' },
    { amazon_music_id: 'B0UNKNOWN' },
  ], 20_000);

  assert.deepEqual(resolved.map((track) => track.trackId), [77, null]);
  assert.equal(db.trackInserts, 0);
  assert.equal(db.aliases.has('amazon_music_id:B0UNKNOWN'), false);
});

test('stale Amazon alias is repaired when OFF VOCAL title resolves to its own ISRC track', async () => {
  const db = new FakeDb(
    [
      ['amazon_music_id:B0OFFVOCAL', 41],
      ['isrc:JPSR02600001', 42],
    ],
    [
      { id: 41, isrc: 'JPSR02600000', title: 'BAN', artist: '櫻坂46', last_seen_at: 8_000 },
      {
        id: 42,
        spotify_id: 'spotify-off-vocal',
        isrc: 'JPSR02600001',
        title: 'BAN -OFF VOCAL ver.-',
        artist: '櫻坂46',
        last_seen_at: 9_000,
      },
    ],
  );

  const [resolved] = await resolveAmazonMusicTracks(db, [{
    amazon_music_id: 'B0OFFVOCAL',
    title: 'BAN -OFF VOCAL ver.-',
    artist: '櫻坂46',
  }], 25_000);

  assert.equal(resolved.trackId, 42);
  assert.equal(resolved.isrc, 'JPSR02600001');
  assert.equal(db.aliases.get('amazon_music_id:B0OFFVOCAL'), 42);
  assert.equal(db.trackInserts, 0);
});

test('missing Amazon ISRC is recovered only from a unique title-artist ISRC identity', async () => {
  const db = new FakeDb(
    [['isrc:JPABC2600005', 88]],
    [{ spotify_id: 'spotify-ban', isrc: 'JPABC2600005', title: 'BAN', artist: '櫻坂46', last_seen_at: 9_000 }],
  );
  const [resolved] = await resolveAmazonMusicTracks(db, [{
    amazon_music_id: 'B0AMAZON005',
    title: 'BAN',
    artist: '櫻坂46',
  }], 30_000);

  assert.equal(resolved.isrc, 'JPABC2600005');
  assert.equal(resolved.trackId, 88);
  assert.equal(db.aliases.get('amazon_music_id:B0AMAZON005'), 88);
  assert.equal(db.trackInserts, 0);
});

test('ambiguous title-artist ISRC candidates never link an Amazon id', async () => {
  const db = new FakeDb(
    [
      ['isrc:JPABC2600006', 91],
      ['isrc:JPABC2600007', 92],
    ],
    [
      { spotify_id: 'spotify-a', isrc: 'JPABC2600006', title: 'Same Song', artist: '櫻坂46', last_seen_at: 9_000 },
      { spotify_id: 'spotify-b', isrc: 'JPABC2600007', title: 'Same Song', artist: '櫻坂46', last_seen_at: 10_000 },
    ],
  );
  const [resolved] = await resolveAmazonMusicTracks(db, [{
    amazon_music_id: 'B0AMBIGUOUS',
    title: 'Same Song',
    artist: '櫻坂46',
  }], 40_000);

  assert.equal(resolved.isrc, null);
  assert.equal(resolved.trackId, null);
  assert.equal(db.aliases.has('amazon_music_id:B0AMBIGUOUS'), false);
  assert.equal(db.trackInserts, 0);
});

test('large Amazon catalogs split title identity queries below the D1 variable ceiling', async () => {
  const entries = [];
  const trackRows = [];
  const amazonTracks = [];
  for (let index = 1; index <= 174; index += 1) {
    const isrc = `JPABC${String(2600000 + index).padStart(7, '0')}`;
    entries.push([`isrc:${isrc}`, index]);
    trackRows.push({
      spotify_id: `spotify-${index}`,
      isrc,
      title: `Song ${index}`,
      artist: '櫻坂46',
      last_seen_at: 10_000 + index,
    });
    amazonTracks.push({
      amazon_music_id: `B0CHUNK${String(index).padStart(4, '0')}`,
      title: `Song ${index}`,
      artist: '櫻坂46',
    });
  }
  const db = new FakeDb(entries, trackRows);
  const resolved = await resolveAmazonMusicTracks(db, amazonTracks, 50_000);

  assert.equal(resolved.length, 174);
  assert.equal(resolved.filter((track) => Number.isSafeInteger(Number(track.trackId))).length, 174);
  assert.ok(db.maxTitleBindings <= 80, `title query used ${db.maxTitleBindings} variables`);
  assert.equal(db.trackInserts, 0);
});
