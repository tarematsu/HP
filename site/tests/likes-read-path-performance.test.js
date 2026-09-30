import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet as trackHistory } from '../functions/api/track-history.js';

test('likes endpoint stays read-only and uses one materialized service read', async () => {
  const requests = [];
  const service = {
    async fetch(request) {
      requests.push(new URL(request.url));
      return new Response(JSON.stringify({
        ok: true,
        mode: 'likes',
        timezone: 'UTC',
        rows: [],
        ranking_included: true,
        ranking: [{
          rank: 1,
          track_identity: 'spotify:test-track',
          spotify_id: 'test-track',
          isrc: 'JPAAA0000001',
          title: 'Test Song',
          artist: '櫻坂46',
          display_title: 'Test Song',
          thumbnail_url: 'https://example.test/cover.jpg',
          latest_like_count: 123,
          latest_observed_at: 1_700_000_000_000,
        }],
        ranking_summary: {
          track_count: 1,
          max_like_count: 123,
          latest_observed_at: 1_700_000_000_000,
        },
        ranking_truncated: false,
        read_path: 'r2-track-history-status-read-model',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };

  const response = await trackHistory({
    request: new Request('https://pages.test/api/track-history?ranking_only=1&ranking_limit=500'),
    env: { PAGES_READ_MODEL_SERVICE: service },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.read_path, 'r2-track-history-status-read-model');
  assert.equal(payload.ranking.length, 1);
  assert.equal(payload.ranking[0].latest_like_count, 123);
  assert.equal(payload.ranking[0].thumbnail_url, 'https://example.test/cover.jpg');
  assert.equal(payload.ranking_summary.track_count, 1);
  assert.equal(payload.ranking_truncated, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('key'), 'track-history');
  assert.equal(requests[0].searchParams.get('api'), '1');
  assert.equal(requests[0].searchParams.get('ranking_only'), '1');
  assert.equal(requests[0].searchParams.get('ranking_limit'), '500');
});
