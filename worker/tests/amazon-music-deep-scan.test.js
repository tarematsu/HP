import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMAZON_MUSIC_DEEP_SCAN_STATE_KEY,
  continueAmazonMusicDeepScan,
  scanAmazonOverallBatch,
} from '../src/amazon-music-deep-scan.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

function track(id, title, artist = '櫻坂46') {
  return {
    primaryText: { text: title },
    secondaryText: artist,
    primaryTextLink: { deeplink: `/tracks/${id}/${title}` },
  };
}

function chartDocument(items, next = null) {
  return {
    methods: [{
      template: {
        items,
        onCreated: next ? [{
          url: `https://fe.mesk.skill.music.a2z.com/api/showChartsWidget?genreTitle=browsePanel&genreId=popularTracks&widgetId=top-songs&next=${encodeURIComponent(next)}&userHash=${encodeURIComponent(JSON.stringify({ level: 'LIBRARY_MEMBER' }))}`,
        }] : [],
      },
    }],
  };
}

function amazonFetch(pages) {
  let pageIndex = 0;
  return async (url) => {
    const value = String(url);
    if (value.includes('/config.json?')) {
      return jsonResponse({
        accessToken: 'access',
        deviceId: 'device',
        sessionId: 'session',
        version: '1.0.11376.0',
        csrf: { token: 'csrf', ts: 123, rnd: 456 },
      });
    }
    if (value.endsWith('/api/showHome')) return jsonResponse({ methods: [] });
    if (value.includes('/api/showChartsWidget?')) {
      const page = pages[Math.min(pageIndex, pages.length - 1)];
      pageIndex += 1;
      return jsonResponse(page);
    }
    throw new Error(`Unexpected request: ${value}`);
  };
}

class FakeR2 {
  constructor(entries = []) {
    this.values = new Map(entries.map(([key, value]) => [key, JSON.stringify(value)]));
  }

  async get(key) {
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      async json() { return JSON.parse(value); },
      async text() { return value; },
    };
  }

  async put(key, body) {
    this.values.set(key, String(body));
  }
}

test('overall deep scan resumes from an absolute rank and persists the next chart URL', async () => {
  const next = JSON.stringify({ offset: 10956, nextToken: 'token-2', count: 20 });
  const fetchImpl = amazonFetch([
    chartDocument([
      track('OTHER', 'Other'),
      track('TARGET', 'Target Song'),
    ], next),
  ]);

  const result = await scanAmazonOverallBatch(fetchImpl, {
    targetIds: ['TARGET'],
    startRank: 10954,
    maxPages: 1,
    targetRank: 1_000_000,
  });

  assert.equal(result.scanned_tracks, 10956);
  assert.equal(result.pages_scanned, 1);
  assert.equal(result.complete, false);
  assert.equal(result.exhausted, false);
  assert.match(result.next_url, /showChartsWidget/);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].rank, 10956);
});

test('deep scan saves progress and republishes discovered Amazon rank', async () => {
  const artistLatestKey = 'amazon-music/artist/B08P3RHP1P/latest.json';
  const readModelKey = 'amazon-music/read-model/latest.json';
  const snapshot = {
    version: 1,
    source: 'amazon-music-jp-web',
    artist_id: 'B08P3RHP1P',
    snapshot_date: '2026-09-30',
    observed_at: 1,
    all_tracks: [
      { amazon_music_id: 'A1', track_id: 101, title: 'Song A' },
      { amazon_music_id: 'A2', track_id: 102, title: 'Song B' },
    ],
    catalog_popular_hits: [],
    catalog_popular_scanned: 0,
    catalog_popular_exhausted: false,
  };
  const readModel = {
    version: 1,
    source: 'amazon-music-jp-web',
    artist_id: 'B08P3RHP1P',
    artist_name: '櫻坂46',
    snapshot_date: '2026-09-30',
    observed_at: 1,
    follower: null,
    track_count: 2,
    tracks: [
      { amazon_music_id: 'A1', track_id: 101, title: 'Song A', amazon_rank: null },
      { amazon_music_id: 'A2', track_id: 102, title: 'Song B', amazon_rank: null },
    ],
    history: [{
      snapshot_date: '2026-09-30',
      observed_at: 1,
      follower_count: null,
      tracks: [
        { amazon_music_id: 'A1', track_id: 101, amazon_rank: null },
        { amazon_music_id: 'A2', track_id: 102, amazon_rank: null },
      ],
    }],
  };
  const r2 = new FakeR2([
    [artistLatestKey, snapshot],
    [readModelKey, readModel],
  ]);
  const fetchImpl = amazonFetch([
    chartDocument([
      track('OTHER', 'Other'),
      track('A2', 'Song B'),
    ]),
  ]);

  const result = await continueAmazonMusicDeepScan({ PAGES_RESPONSE_R2: r2 }, 123456789, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.complete, true);
  assert.equal(result.exhausted, true);
  assert.equal(result.scanned_tracks, 2);
  assert.equal(result.hits, 1);

  const state = JSON.parse(r2.values.get(AMAZON_MUSIC_DEEP_SCAN_STATE_KEY));
  assert.equal(state.hits[0].amazon_music_id, 'A2');
  assert.equal(state.hits[0].rank, 2);
  assert.equal(state.hits[0].track_id, null);

  const updatedModel = JSON.parse(r2.values.get(readModelKey));
  assert.deepEqual(updatedModel.tracks.map((item) => item.amazon_rank), [null, 2]);
  assert.deepEqual(updatedModel.history[0].tracks.map((item) => item.amazon_rank), [null, 2]);

  const publicKey = pagesActionsR2ResponseKey('amazon-music');
  const envelope = JSON.parse(r2.values.get(publicKey));
  assert.equal(envelope.version, 1);
  const body = JSON.parse(envelope.body);
  assert.deepEqual(body.tracks.map((item) => item.amazon_rank), [null, 2]);
});
