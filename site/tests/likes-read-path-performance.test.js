import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet as trackHistory } from '../functions/api/track-history.js';

test('likes endpoint stays read-only and uses only three bounded reads', async () => {
  const prepared = [];
  const writes = [];
  const db = {
    prepare(sql) {
      prepared.push(sql);
      const statement = {
        args: [],
        bind(...args) {
          statement.args = args;
          return statement;
        },
        async all() {
          if (sql.includes('FROM sh_track_ranking_current current')) {
            return {
              results: [{
                track_identity: 'spotify:test-track',
                track_id: 1,
                current_title: 'Test Song',
                current_artist: '櫻坂46',
                direct_title: 'Test Song',
                direct_artist: '櫻坂46',
                isrc_title: null,
                isrc_artist: null,
                spotify_title: null,
                spotify_artist: null,
                isrc: 'JPAAA0000001',
                spotify_id: 'test-track',
                latest_like_count: 123,
                latest_observed_at: 1_700_000_000_000,
                latest_occurrence_key: 'occurrence:1',
              }],
            };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes("model_key='track-history-status'")) {
            return {
              payload_json: JSON.stringify({
                ranking: [{
                  track_identity: 'spotify:test-track',
                  spotify_id: 'test-track',
                  isrc: 'JPAAA0000001',
                  title: 'Test Song',
                  artist: '櫻坂46',
                  display_title: 'Test Song',
                  thumbnail_url: 'https://example.test/cover.jpg',
                }],
              }),
            };
          }
          if (sql.includes('FROM sh_track_ranking_current')) {
            return {
              track_count: 1,
              max_like_count: 123,
              latest_observed_at: 1_700_000_000_000,
            };
          }
          return null;
        },
        async run() {
          writes.push(sql);
          throw new Error('likes request must not write');
        },
      };
      return statement;
    },
  };

  const response = await trackHistory({
    request: new Request('https://pages.test/api/track-history?ranking_only=1&ranking_limit=500'),
    env: { MINUTE_DB: db },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.read_path, 'read_only');
  assert.equal(payload.ranking.length, 1);
  assert.equal(payload.ranking[0].latest_like_count, 123);
  assert.equal(payload.ranking[0].thumbnail_url, 'https://example.test/cover.jpg');
  assert.equal(payload.ranking_summary.track_count, 1);
  assert.equal(payload.ranking_truncated, false);
  assert.equal(prepared.length, 3);
  assert.equal(prepared.some((sql) => /\b(?:UPDATE|INSERT|DELETE)\b/i.test(sql)), false);
  assert.deepEqual(writes, []);
});
