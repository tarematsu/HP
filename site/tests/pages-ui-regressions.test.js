import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  SAKURAZAKA_MINUTE_SERIES_SQL,
  mergeSakurazakaSeriesRows,
} from '../functions/api/sakurazaka46jp.js';
import { onRequestGet as trackHistory } from '../functions/api/track-history.js';
import {
  metadataFallback,
  normalizePlaybackTrack,
} from '../functions/lib/playback.js';
import { summarizeCompleteTrackRows } from '../public/history/history-request-guard.js';

test('dashboard playback restores artwork from string and object Stationhead metadata', () => {
  const rawObject = {
    track: {
      name: 'Test song',
      artist_name: 'Test artist',
      album: { images: [{ url: 'https://images.example.test/cover.jpg' }] },
    },
  };
  assert.equal(metadataFallback(JSON.stringify(rawObject)).thumbnail_url, 'https://images.example.test/cover.jpg');
  assert.equal(metadataFallback(rawObject).thumbnail_url, 'https://images.example.test/cover.jpg');

  const normalized = normalizePlaybackTrack({
    spotify_id: 'spotify-test',
    raw_json: rawObject,
    duration_ms: 180000,
  }, 0, { currentIndex: 0, progressMs: 1000 });
  assert.equal(normalized.thumbnail_url, 'https://images.example.test/cover.jpg');
  assert.equal(normalized.spotify_url, 'https://open.spotify.com/track/spotify-test');
  assert.equal('spotify_id' in normalized, false);
  assert.equal(normalized.is_current, true);
});

test('dashboard entry reveals images only after their load event', () => {
  const source = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
  assert.match(source, /installImageState\('trackImage'\)/);
  assert.match(source, /classList\.add\('is-loaded'\)/);
  assert.match(source, /addEventListener\('error', failed\)/);
});

test('official stream series includes live and migrated minute-fact sources', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_hosts(id INTEGER PRIMARY KEY,current_handle TEXT);
    CREATE TABLE sh_minute_facts(
      id INTEGER PRIMARY KEY,
      minute_at INTEGER NOT NULL,
      source_code INTEGER NOT NULL,
      listener_count INTEGER,
      host_id INTEGER
    );
    CREATE TABLE sh_minute_fact_context(fact_id INTEGER PRIMARY KEY,host_id INTEGER);
    INSERT INTO sh_hosts VALUES(1,'sakurazaka46jp');
    INSERT INTO sh_minute_facts VALUES
      (1,100000,1,101,1),
      (2,160000,2,102,1),
      (3,220000,3,103,NULL),
      (4,280000,4,104,NULL);
    INSERT INTO sh_minute_fact_context VALUES(3,1),(4,1);
  `);

  const row = db.prepare(SAKURAZAKA_MINUTE_SERIES_SQL).get(100000, 100000, 340000);
  const points = JSON.parse(row.points_json);
  assert.equal(row.point_count, 4);
  assert.deepEqual(points.map((point) => point[1]), [101, 102, 103, 104]);
});

test('official stream fallback does not duplicate an existing minute-fact series', () => {
  const primary = [{
    event_name: 'Official event',
    started_at: 1_000_000,
    samples: [{ elapsed: 0, listener: 100, sourceSamples: 1 }],
    source: 'historical_import',
  }];
  const fallback = [{
    event_name: 'Official event from news',
    started_at: 1_000_000 + 5 * 60_000,
    samples: [{ elapsed: 0, listener: 101, sourceSamples: 1 }],
    source: 'official_news_fail_safe',
  }, {
    event_name: 'Missing event',
    started_at: 2_000_000,
    samples: [{ elapsed: 0, listener: 200, sourceSamples: 1 }],
    source: 'official_news_fail_safe',
  }];
  const merged = mergeSakurazakaSeriesRows(primary, fallback);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].source, 'historical_import');
  assert.equal(merged[1].event_name, 'Missing event');
});

test('track totals exclude incomplete dates instead of reporting partial plays', () => {
  const summary = summarizeCompleteTrackRows([
    { play_date: '2026-07-20', track_key: 'a', play_count: 3, period_complete: true },
    { play_date: '2026-07-20', track_key: 'b', play_count: 2, play_count_excluded: false },
    { play_date: '2026-07-21', track_key: 'c', play_count: 99, play_count_excluded: true },
  ]);
  assert.deepEqual(summary, { days: 1, tracks: 2, total: 5, maximum: 3 });
});

test('like summary totals all complete weekly rows, not only the bounded ranking', () => {
  const source = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
  assert.match(source, /function completeWeekPlayCount\(rows\)/);
  assert.match(source, /play_count_excluded === true/);
  assert.match(source, /week_play_count: completeWeekPlayCount\(weekRows\)/);
  assert.doesNotMatch(source, /week_play_count: state\.rows\.reduce/);
});

function trackHistoryDb(rankingSize = 0) {
  const prepared = [];
  return {
    prepared,
    prepare(sql) {
      prepared.push(sql);
      const statement = {
        bind() { return statement; },
        async all() { return { results: [] }; },
        async first() {
          return {
            payload_json: JSON.stringify({
              ranking: Array.from({ length: rankingSize }, (_, index) => ({ rank: index + 1 })),
              ranking_summary: { track_count: rankingSize },
            }),
          };
        },
      };
      return statement;
    },
  };
}

test('normal track history skips the unused like-ranking status payload', async () => {
  const db = trackHistoryDb(300);
  const response = await trackHistory({
    request: new Request('https://pages.test/api/track-history?from=2026-07-20&to=2026-07-20&ranking=0'),
    env: { MINUTE_DB: db },
  });
  const payload = await response.json();
  assert.equal(payload.ranking_included, false);
  assert.deepEqual(payload.ranking, []);
  assert.equal(db.prepared.some((sql) => sql.includes("model_key='track-history-status'")), false);
});

test('like ranking response is bounded for mobile rendering', async () => {
  const db = trackHistoryDb(300);
  const response = await trackHistory({
    request: new Request('https://pages.test/api/track-history?from=2026-07-20&to=2026-07-20&ranking_limit=40'),
    env: { MINUTE_DB: db },
  });
  const payload = await response.json();
  assert.equal(payload.ranking.length, 40);
  assert.equal(payload.ranking_truncated, true);
  assert.equal(payload.ranking_limit, 40);
});

test('history guard is installed before the consolidated page runtime', () => {
  const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
  const guard = readFileSync(new URL('../public/history/history-request-guard.js', import.meta.url), 'utf8');
  assert.ok(entry.indexOf('history-request-guard.js') < entry.indexOf('history-lite.js'));
  assert.match(guard, /searchParams\.set\('ranking', '0'\)/);
  assert.match(guard, /searchParams\.set\('revision', '2'\)/);
});