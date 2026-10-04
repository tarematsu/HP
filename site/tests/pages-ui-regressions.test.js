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

test('artwork retry stays out of the initial entry and runs only with the current runtime', () => {
  const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(entry, /IMAGE_RETRY_DELAYS|installImageRetry|MutationObserver/);
  assert.match(runtime, /const IMAGE_RETRY_DELAYS/);
  assert.match(runtime, /classList\.add\('is-loaded'\)/);
  assert.match(runtime, /addEventListener\('error', failed\)/);
  assert.doesNotMatch(runtime, /MutationObserver/);
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
  const shell = readFileSync(new URL('../public/likes-shell.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
  assert.match(shell, /id: 'likesView'/);
  assert.match(shell, /id="likesRankingList"/);
  assert.doesNotMatch([shell, page].join('\n'), /今週再生|再生曲|href="\/history/);
  assert.doesNotMatch(source, /week_play_count|completeWeekPlayCount|attachWeeklyPlays|play_count_excluded/);
  assert.match(source, /ranking_only=1/);
});

function materializedRankingPayload(rankingSize = 0) {
  const rows = Array.from({ length: rankingSize }, (_, index) => ({
    rank: index + 1,
    track_identity: `track:${index + 1}`,
    track_id: index + 1,
    title: `Song ${index + 1}`,
    artist: '櫻坂46',
    latest_like_count: rankingSize - index,
    latest_observed_at: 1_700_000_000_000 + index,
    latest_occurrence_key: `occurrence:${index + 1}`,
  }));
  return {
    ok: true,
    mode: 'likes',
    rows: [],
    ranking: rows,
    ranking_summary: {
      track_count: rows.length,
      max_like_count: rows[0]?.latest_like_count || 0,
      latest_observed_at: rows.at(-1)?.latest_observed_at || null,
    },
    ranking_truncated: false,
    ranking_scope: 'all-time-latest-counter',
    generated_at: rows.at(-1)?.latest_observed_at || null,
    method: 'current_track_like_ranking',
  };
}

test('like ranking proxies the materialized ranking payload directly', async () => {
  const requests = [];
  const full = materializedRankingPayload(300);
  const response = await trackHistory({
    request: new Request('https://pages.test/api/track-history?ranking_only=1&ranking_limit=40'),
    env: {
      PAGES_READ_MODEL_SERVICE: {
        async fetch(request) {
          const url = new URL(request.url);
          requests.push(url);
          const limit = Number(url.searchParams.get('ranking_limit')) || 200;
          return new Response(JSON.stringify({
            ...full,
            ranking: full.ranking.slice(0, limit),
            ranking_truncated: full.ranking.length > limit,
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    },
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.mode, 'likes');
  assert.equal(payload.ranking.length, 40);
  assert.equal(payload.ranking_summary.track_count, 300);
  assert.equal(payload.ranking_truncated, true);
  assert.equal(payload.method, 'current_track_like_ranking');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('key'), 'track-history');
  assert.equal(requests[0].searchParams.get('api'), '1');
  assert.equal(requests[0].searchParams.get('ranking_only'), '1');
});

test('normal track history forwards ranking=0 without any D1 ranking read', async () => {
  const requests = [];
  const response = await trackHistory({
    request: new Request('https://pages.test/api/track-history?from=2026-07-20&to=2026-07-20&ranking=0'),
    env: {
      PAGES_READ_MODEL_SERVICE: {
        async fetch(request) {
          requests.push(new URL(request.url));
          return new Response(JSON.stringify({
            ok: true,
            mode: 'tracks',
            rows: [],
            ranking_included: false,
            ranking: [],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    },
  });
  const payload = await response.json();
  assert.equal(payload.ranking_included, false);
  assert.deepEqual(payload.ranking, []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('ranking'), '0');
  assert.equal(requests[0].searchParams.get('from'), '2026-07-20');
  assert.equal(requests[0].searchParams.get('to'), '2026-07-20');
});

test('history runtime uses direct data requests instead of global fetch guards or UI rewrite modules', () => {
  const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
  const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
  const dataClient = readFileSync(new URL('../public/history/history-data-client.js', import.meta.url), 'utf8');
  const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
  assert.doesNotMatch(entry, /history-request-guard|history-current-overlay|pages-ui-tweaks|pages-terminology|history-page-fixes|history-table-cleanup/);
  assert.match(history, /history-data-client\.js/);
  assert.match(dataClient, /fetchHistoryPayload/);
  assert.match(broadcasts, /revision: API_REVISION/);
  assert.doesNotMatch(history, /window\.fetch|pagesUiNativeFetch|officialPartyRequest|MutationObserver/);
});
