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

test('official stream series resolves hosts without the removed minute-fact host column', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_hosts(id INTEGER PRIMARY KEY,current_handle TEXT);
    CREATE TABLE sh_broadcast_sessions(id INTEGER PRIMARY KEY,host_id INTEGER);
    CREATE TABLE sh_minute_facts(
      id INTEGER PRIMARY KEY,
      minute_at INTEGER NOT NULL,
      source_code INTEGER NOT NULL,
      listener_count INTEGER,
      broadcast_session_id INTEGER
    );
    CREATE INDEX idx_sh_minute_facts_time ON sh_minute_facts(minute_at ASC,id ASC);
    CREATE TABLE sh_minute_fact_context_v2(
      fact_id INTEGER PRIMARY KEY,
      host_id_override INTEGER
    );
    INSERT INTO sh_hosts VALUES(1,'sakurazaka46jp');
    INSERT INTO sh_broadcast_sessions VALUES(10,1);
    INSERT INTO sh_minute_facts VALUES
      (1,100000,1,101,10),
      (2,160000,2,102,10),
      (3,220000,3,103,NULL),
      (4,280000,4,104,NULL);
    INSERT INTO sh_minute_fact_context_v2 VALUES(3,1),(4,1);
  `);

  assert.doesNotMatch(SAKURAZAKA_MINUTE_SERIES_SQL, /\bf\.host_id\b/);
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

test('integrated likes UI contains no playback totals or weekly play merge', () => {
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
  assert.match(page, /id="likesView"/);
  assert.match(page, /id="likesRankingList"/);
  assert.doesNotMatch(page, /今週再生|再生曲|href="\/history/);
  assert.doesNotMatch(source, /week_play_count|completeWeekPlayCount|attachWeeklyPlays|play_count_excluded/);
  assert.match(source, /ranking_only=1/);
});

function directRankingDb(rankingSize = 0) {
  const prepared = [];
  const rows = Array.from({ length: rankingSize }, (_, index) => ({
    track_identity: `track:${index + 1}`,
    track_id: index + 1,
    title: `Song ${index + 1}`,
    artist: '櫻坂46',
    latest_like_count: rankingSize - index,
    latest_observed_at: 1_700_000_000_000 + index,
    latest_occurrence_key: `occurrence:${index + 1}`,
  }));
  return {
    prepared,
    prepare(sql) {
      prepared.push(sql);
      const statement = {
        args: [],
        bind(...args) { statement.args = args; return statement; },
        async all() {
          if (sql.includes('FROM sh_track_ranking_current')) {
            return { results: rows.slice(0, Number(statement.args[0] || 500)) };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM sh_track_ranking_current')) {
            return {
              track_count: rows.length,
              max_like_count: rows[0]?.latest_like_count || 0,
              latest_observed_at: rows.at(-1)?.latest_observed_at || null,
            };
          }
          return null;
        },
      };
      return statement;
    },
  };
}

test('like ranking reads the current ranking projection directly', async () => {
  const db = directRankingDb(300);
  const response = await trackHistory({
    request: new Request('https://pages.test/api/track-history?ranking_only=1&ranking_limit=40'),
    env: { MINUTE_DB: db },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.mode, 'likes');
  assert.equal(payload.ranking.length, 40);
  assert.equal(payload.ranking_summary.track_count, 300);
  assert.equal(payload.ranking_truncated, true);
  assert.equal(payload.method, 'current_track_like_ranking');
  assert.equal(db.prepared.some((sql) => sql.includes('sh_pages_track_history_read_model')), false);
});

test('normal track history skips the unused like-ranking status payload', async () => {
  const prepared = [];
  const db = {
    prepare(sql) {
      prepared.push(sql);
      const statement = {
        bind() { return statement; },
        async all() { return { results: [] }; },
        async first() { return null; },
      };
      return statement;
    },
  };
  const response = await trackHistory({
    request: new Request('https://pages.test/api/track-history?from=2026-07-20&to=2026-07-20&ranking=0'),
    env: { MINUTE_DB: db },
  });
  const payload = await response.json();
  assert.equal(payload.ranking_included, false);
  assert.deepEqual(payload.ranking, []);
  assert.equal(prepared.some((sql) => sql.includes("model_key='track-history-status'")), false);
});

test('history guard is installed before the consolidated embedded runtime', () => {
  const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
  const guard = readFileSync(new URL('../public/history/history-request-guard.js', import.meta.url), 'utf8');
  assert.ok(entry.indexOf('history-request-guard.js') < entry.indexOf('history-lite.js'));
  assert.doesNotMatch(guard, /\/api\/track-history|ranking', '0'/);
  assert.match(guard, /searchParams\.set\('revision', '3'\)/);
});
