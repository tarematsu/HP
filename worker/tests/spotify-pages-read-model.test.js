import assert from 'node:assert/strict';
import test from 'node:test';

import {
  spotifyArtistChartSql,
  spotifyPlaycountSql,
  spotifyTrendSql,
} from '../../site/functions/api/spotify-playcounts.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import {
  publishSpotifyPagesReadModel,
  requestSpotifyReadModelRefresh,
  SPOTIFY_READ_MODEL_REFRESH_TYPE,
} from '../src/spotify-pages-read-model.js';

function db() {
  return {
    prepare(sql) {
      let results = [];
      if (sql === spotifyPlaycountSql()) {
        results = [{
          artist_key: 'sakurazaka46',
          snapshot_date: '2026-09-29',
          track_id: 'track-1',
          name: 'Song 1',
          playcount: 1000,
          delta: 25,
          collected_at: 123,
          is_carried_forward: 0,
        }];
      } else if (sql === spotifyTrendSql()) {
        results = [{
          artist_key: 'sakurazaka46',
          artist_name: '櫻坂46',
          current_rank: 1,
          snapshot_date: '2026-09-29',
          total_delta: 25,
          top10_delta: 25,
          top10_year_delta: 25,
        }];
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
      } else {
        assert.fail(`unexpected SQL: ${sql}`);
      }
      return { async all() { return { results }; } };
    },
  };
}

test('Spotify read model writes the canonical Actions R2 envelope only when body changes', async () => {
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
  const envelope = JSON.parse(writes[0].body);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.cadence_seconds, 0);
  assert.equal(envelope.updated_at, 1000);
  assert.equal(JSON.parse(envelope.body).groups.sakurazaka46.total_delta, 25);
  assert.equal(JSON.parse(envelope.body).artist_chart.latest_chart_date, '2026-09-29');

  const second = await publishSpotifyPagesReadModel(env, { now: 2000 });
  assert.equal(second.published, false);
  assert.equal(second.changed, false);
  assert.equal(writes.length, 1);
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
