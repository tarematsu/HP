import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amazonMusicJstDate,
  amazonMusicWeekKey,
  collectAmazonMusicSnapshot,
} from '../src/amazon-music-collector.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

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
    if (!this.sql.includes('FROM sh_track_aliases')) return { results: [] };
    const results = [];
    if (this.sql.includes("alias_type='amazon_music_id'")) {
      for (const value of this.bindings) {
        const trackId = this.db.aliases.get(`amazon_music_id:${String(value)}`);
        if (trackId != null) results.push({ alias_value: String(value), track_id: trackId });
      }
    }
    return { results };
  }
}

class AliasDb {
  constructor(entries = []) {
    this.aliases = new Map(entries);
  }

  prepare(sql) {
    return new Statement(this, sql);
  }
}

class FakeR2 {
  constructor() {
    this.values = new Map();
    this.puts = [];
  }

  async head(key) {
    return this.values.has(key) ? { key } : null;
  }

  async get(key) {
    if (!this.values.has(key)) return null;
    const value = this.values.get(key);
    return {
      async text() { return value; },
      async json() { return JSON.parse(value); },
    };
  }

  async put(key, body) {
    this.values.set(key, String(body));
    this.puts.push(key);
  }
}

function artistDocument() {
  return {
    methods: [{
      template: {
        followerCount: 53124,
        widgets: [{
          header: 'Top Songs',
          items: [
            {
              primaryText: { text: '1. Song A' },
              secondaryText: '櫻坂46',
              iconButton: { observer: { storageKey: 'ALBUM1:A1' } },
            },
            {
              primaryText: { text: '2. Song B' },
              secondaryText: '櫻坂46',
              iconButton: { observer: { storageKey: 'ALBUM2:A2' } },
            },
          ],
        }],
      },
    }],
  };
}

function rankingDocument(items) {
  return {
    methods: [{
      template: {
        widgets: [{
          items: items.map(({ id, title, artist }) => ({
            primaryText: { text: title },
            secondaryText: artist,
            primaryTextLink: { deeplink: `/tracks/${id}/${title}` },
          })),
        }],
      },
    }],
  };
}

function client({ top50Hit = false } = {}) {
  return {
    async fetchArtist() { return artistDocument(); },
    async fetchArtistTracks() {
      return [
        { amazon_music_id: 'A3', title: 'Song C', artist: '櫻坂46' },
        { amazon_music_id: 'A1', title: 'Song A', artist: '櫻坂46' },
        { amazon_music_id: 'A2', title: 'Song B', artist: '櫻坂46' },
      ];
    },
    async fetchPlaylist() {
      return rankingDocument(top50Hit
        ? [
            { id: 'OTHER', title: 'Other', artist: 'Other' },
            { id: 'A2', title: 'Song B', artist: '櫻坂46' },
          ]
        : [{ id: 'OTHER', title: 'Other', artist: 'Other' }]);
    },
    async fetchOverallTrackRanks() {
      return {
        scanned_tracks: 10020,
        exhausted: true,
        hits: [{ amazon_music_id: 'A1', title: 'Song A', artist: '櫻坂46', rank: 42 }],
      };
    },
    async fetchTrack() { throw new Error('known aliases must avoid track detail calls'); },
    async fetchArtistPageHtml() { throw new Error('exact follower count is already present'); },
  };
}

function env() {
  return {
    MINUTE_DB: new AliasDb([
      ['amazon_music_id:A1', 101],
      ['amazon_music_id:A2', 102],
      ['amazon_music_id:A3', 103],
    ]),
    PAGES_RESPONSE_R2: new FakeR2(),
  };
}

const TUESDAY_1030_JST = Date.UTC(2026, 8, 29, 1, 30, 0);

test('JST date and weekly key use Tuesday as the Amazon Japan chart boundary', () => {
  assert.equal(amazonMusicJstDate(TUESDAY_1030_JST), '2026-09-29');
  assert.equal(amazonMusicWeekKey(TUESDAY_1030_JST), '2026-09-29');
  assert.equal(amazonMusicWeekKey(TUESDAY_1030_JST + 6 * 86400_000), '2026-09-29');
  assert.equal(amazonMusicWeekKey(TUESDAY_1030_JST + 7 * 86400_000), '2026-10-06');
});

test('daily collection preserves tracks and publishes only Amazon overall rank', async () => {
  const bindings = env();
  const result = await collectAmazonMusicSnapshot(bindings, TUESDAY_1030_JST, client());

  assert.equal(result.follower_count, 53124);
  assert.equal(result.follower_delta, null);
  assert.equal(result.all_tracks, 3);
  assert.equal(result.resolved_track_ids, 3);
  assert.equal(result.japan_top_50_hits, 0);
  assert.equal(result.japan_top_50_stored, false);
  assert.equal(result.catalog_popular_hits, 1);
  assert.equal(result.catalog_popular_scanned, 10020);
  assert.equal(result.catalog_popular_exhausted, true);
  assert.equal(result.read_model_published, true);
  assert.equal(bindings.PAGES_RESPONSE_R2.puts.some((key) => key.includes('japan-top-50')), false);
  assert.equal(bindings.PAGES_RESPONSE_R2.values.has('amazon-music/artist/B08P3RHP1P/daily/2026-09-29.json'), true);

  const readModel = JSON.parse(bindings.PAGES_RESPONSE_R2.values.get('amazon-music/read-model/latest.json'));
  assert.equal(readModel.follower.count, 53124);
  assert.equal(readModel.follower.delta, null);
  assert.deepEqual(readModel.tracks.map((track) => track.track_id), [103, 101, 102]);
  assert.deepEqual(readModel.tracks.map((track) => track.amazon_rank), [null, 42, null]);
  assert.equal(readModel.tracks.some((track) => Object.hasOwn(track, 'popular_rank')), false);
  assert.equal(readModel.history[0].tracks.some((track) => Object.hasOwn(track, 'popular_rank')), false);
  assert.equal(readModel.history.length, 1);

  const dailySnapshot = JSON.parse(bindings.PAGES_RESPONSE_R2.values.get('amazon-music/artist/B08P3RHP1P/daily/2026-09-29.json'));
  assert.equal(Object.hasOwn(dailySnapshot, 'popular_tracks'), false);
  assert.equal(dailySnapshot.all_tracks.some((track) => Object.hasOwn(track, 'rank')), false);

  const publicKey = pagesActionsR2ResponseKey('amazon-music');
  const envelope = JSON.parse(bindings.PAGES_RESPONSE_R2.values.get(publicKey));
  assert.equal(envelope.version, 1);
  const body = JSON.parse(envelope.body);
  assert.equal(body.ok, true);
  assert.equal(body.snapshot_date, '2026-09-29');
  assert.equal(body.tracks.length, 3);
});

test('next-day collection strips legacy popular_rank from retained history', async () => {
  const bindings = env();
  await collectAmazonMusicSnapshot(bindings, TUESDAY_1030_JST, client());
  const legacy = JSON.parse(bindings.PAGES_RESPONSE_R2.values.get('amazon-music/read-model/latest.json'));
  legacy.history[0].tracks[0].popular_rank = 1;
  bindings.PAGES_RESPONSE_R2.values.set('amazon-music/read-model/latest.json', JSON.stringify(legacy));

  const second = await collectAmazonMusicSnapshot(bindings, TUESDAY_1030_JST + 86400_000, client());
  assert.equal(second.follower_delta, 0);
  const readModel = JSON.parse(bindings.PAGES_RESPONSE_R2.values.get('amazon-music/read-model/latest.json'));
  assert.equal(readModel.follower.delta, 0);
  assert.equal(readModel.history.length, 2);
  assert.deepEqual(readModel.history.map((point) => point.snapshot_date), ['2026-09-29', '2026-09-30']);
  assert.equal(readModel.history.flatMap((point) => point.tracks).some((track) => Object.hasOwn(track, 'popular_rank')), false);
});

test('Japan Top 50 history is written once for the week only when Sakurazaka appears', async () => {
  const bindings = env();
  const first = await collectAmazonMusicSnapshot(bindings, TUESDAY_1030_JST, client({ top50Hit: true }));
  const second = await collectAmazonMusicSnapshot(bindings, TUESDAY_1030_JST + 86400_000, client({ top50Hit: true }));

  assert.equal(first.japan_top_50_hits, 1);
  assert.equal(first.japan_top_50_stored, true);
  assert.equal(second.japan_top_50_stored, false);
  const historyKey = 'amazon-music/japan-top-50/weeks/2026-09-29.json';
  assert.equal(bindings.PAGES_RESPONSE_R2.puts.filter((key) => key === historyKey).length, 1);
  const history = JSON.parse(bindings.PAGES_RESPONSE_R2.values.get(historyKey));
  assert.equal(history.hits[0].rank, 2);
  assert.equal(history.hits[0].track_id, 102);
});
