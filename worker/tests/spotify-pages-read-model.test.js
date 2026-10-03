import assert from 'node:assert/strict';
import test from 'node:test';

import { spotifyMonthlyListenersSql } from '../../site/functions/api/spotify-monthly-listeners.js';
import {
  spotifyArtistChartSql,
  spotifyTrendSql,
} from '../../site/functions/api/spotify-playcounts.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import {
  publishSpotifyPagesReadModel,
  requestSpotifyReadModelRefresh,
  SPOTIFY_READ_MODEL_REFRESH_TYPE,
} from '../src/spotify-pages-read-model.js';
import {
  spotifyLatestDetailSql,
  spotifyLatestSnapshotDatesSql,
} from '../src/spotify-read-model-detail.js';

function detailRow(artistKey, trackId, name, playcount, delta) {
  return {
    artist_key: artistKey,
    snapshot_date: '2026-09-29',
    track_id: trackId,
    spotify_track_id: `track-${trackId}`,
    name,
    playcount,
    delta,
    collected_at: 123,
    is_carried_forward: 0,
  };
}

function db() {
  return {
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async all() {
          let results = [];
          if (sql === spotifyLatestSnapshotDatesSql(3)) {
            results = [
              { artist_key: 'sakurazaka46', snapshot_date: '2026-09-29' },
              { artist_key: 'nogizaka46', snapshot_date: '2026-09-29' },
              { artist_key: 'hinatazaka46', snapshot_date: '2026-09-29' },
            ];
          } else if (sql === spotifyLatestDetailSql()) {
            const [snapshotDate, artistKey] = this.args;
            assert.equal(snapshotDate, '2026-09-29');
            const detailByArtist = {
              sakurazaka46: detailRow('sakurazaka46', 41, 'Song S', 1000, 25),
              nogizaka46: detailRow('nogizaka46', 42, 'Song N', 2000, 40),
              hinatazaka46: detailRow('hinatazaka46', 43, 'Song H', 1500, 30),
            };
            results = detailByArtist[artistKey] ? [detailByArtist[artistKey]] : [];
          } else if (sql === spotifyTrendSql()) {
            results = [
              {
                artist_key: 'sakurazaka46',
                artist_name: '櫻坂46',
                current_rank: 1,
                snapshot_date: '2026-09-29',
                total_delta: 25,
                top10_delta: 25,
                top10_year_delta: 25,
              },
              {
                artist_key: 'nogizaka46',
                artist_name: '乃木坂46',
                current_rank: 2,
                snapshot_date: '2026-09-29',
                total_delta: 40,
                top10_delta: 40,
                top10_year_delta: 40,
              },
              {
                artist_key: 'hinatazaka46',
                artist_name: '日向坂46',
                current_rank: 3,
                snapshot_date: '2026-09-29',
                total_delta: 30,
                top10_delta: 30,
                top10_year_delta: 30,
              },
            ];
          } else if (sql === spotifyArtistChartSql()) {
            results = [{
              chart_date: '2026-09-29',
              artist_key: 'sakurazaka46',
              artist_name: '櫻坂46',
              rank: 16,
              previous_rank: 17,
              peak_rank: 10,
              streak: 3,
              observed_at: 456,
            }];
          } else if (sql === spotifyMonthlyListenersSql()) {
            results = [{
              snapshot_date: '2026-09-29',
              artist_key: 'sakurazaka46',
              artist_name: '櫻坂46',
              monthly_listeners: 345678,
              collected_at: 789,
              current_rank: 1,
            }];
          } else {
            assert.fail(`unexpected SQL: ${sql}`);
          }
          return { results };
        },
      };
      return statement;
    },
  };
}

test('Spotify read model writes all Sakamichi detail groups and skips unchanged bodies', async () => {
  let stored = null;
  const writes = [];
  const r2 = {
    async get(key) {
      assert.equal(key, pagesActionsR2ResponseKey('spotify-playcounts'));
      return stored == null ? null : { async text() { return stored; } };
    },
    async put(key, body) {
      writes.push({ key, body });
      stored = body;
    },
  };
  const env = { OTHER_DB: db(), PAGES_RESPONSE_R2: r2 };

  const first = await publishSpotifyPagesReadModel(env, { now: 1000 });
  assert.equal(first.published, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(first.snapshot_dates, {
    sakurazaka46: '2026-09-29',
    nogizaka46: '2026-09-29',
    hinatazaka46: '2026-09-29',
  });
  assert.equal(first.monthly_listener_revision, '2026-09-29:789:1');
  const envelope = JSON.parse(writes[0].body);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.cadence_seconds, 0);
  assert.equal(envelope.updated_at, 1000);
  assert.equal(envelope.renderer_revision, 'spotify-event-v3');
  const body = JSON.parse(envelope.body);
  assert.deepEqual(Object.keys(body.groups), ['sakurazaka46', 'nogizaka46', 'hinatazaka46']);
  assert.equal(body.groups.sakurazaka46.total_delta, 25);
  assert.equal(body.groups.nogizaka46.total_delta, 40);
  assert.equal(body.groups.hinatazaka46.total_delta, 30);
  assert.equal(body.groups.sakurazaka46.tracks[0].track_id, 41);
  assert.equal(body.groups.nogizaka46.tracks[0].track_id, 42);
  assert.equal(body.groups.hinatazaka46.tracks[0].track_id, 43);
  assert.equal(body.artist_chart.latest_chart_date, '2026-09-29');
  assert.deepEqual(body.monthly_listener_rows, [{
    snapshot_date: '2026-09-29',
    artist_key: 'sakurazaka46',
    artist_name: '櫻坂46',
    monthly_listeners: 345678,
    collected_at: 789,
    current_rank: 1,
  }]);

  const second = await publishSpotifyPagesReadModel(env, { now: 2000 });
  assert.equal(second.published, false);
  assert.equal(second.changed, false);
  assert.equal(writes.length, 1);
});

test('Spotify detail lookup resolves dates first and then seeks indexed artist/date rows', () => {
  const latestSql = spotifyLatestSnapshotDatesSql(3);
  const detailSql = spotifyLatestDetailSql();

  assert.match(latestSql, /FROM sh_spotify_artist_daily/);
  assert.match(latestSql, /GROUP BY artist_key/);
  assert.doesNotMatch(latestSql, /sh_spotify_playcount_daily/);

  assert.match(detailSql, /INDEXED BY idx_sh_spotify_track_targets_artist/);
  assert.match(detailSql, /d\.snapshot_date=\?/);
  assert.match(detailSql, /WHERE target\.artist_key=\?/);
  assert.match(detailSql, /LEFT JOIN music_service_track_refs AS ref/);
  assert.match(detailSql, /ref\.service='spotify'/);
  assert.match(detailSql, /ref\.source_track_id=d\.track_id/);
  assert.match(detailSql, /ref\.track_id/);
  assert.match(detailSql, /d\.track_id AS spotify_track_id/);
  assert.doesNotMatch(detailSql, /MAX\(snapshot_date\)|WITH latest/i);
});

test('Spotify source events use the existing collector queue', async () => {
  const sent = [];
  const queued = await requestSpotifyReadModelRefresh({
    SPOTIFY_PLAYCOUNT_QUEUE: { async send(message) { sent.push(message); } },
  }, 'artist-chart', { chart_date: '2026-09-29' });
  assert.equal(queued, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message_type, SPOTIFY_READ_MODEL_REFRESH_TYPE);
  assert.equal(sent[0].reason, 'artist-chart');
  assert.equal(sent[0].chart_date, '2026-09-29');
});
