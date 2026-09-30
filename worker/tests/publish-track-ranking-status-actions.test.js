import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTrackRanking } from '../../site/functions/lib/track-ranking.js';
import { publishTrackRankingStatus } from '../scripts/publish-track-ranking-status-actions.mjs';

const NOW = Date.UTC(2026, 8, 24, 12);

test('ranking publisher writes the Actions envelope without D1 mutations', async () => {
  const queries = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind() { return this; },
        async all() {
          if (/FROM sh_track_canonical_metadata/.test(sql)) {
            return { results: [{
              track_id: 1,
              title: 'Song A',
              artist: 'Artist A',
              isrc: null,
              spotify_id: null,
              thumbnail_url: null,
            }] };
          }
          return { results: [{
            track_identity: 'track:1', track_id: 1,
            current_title: 'Song A', current_artist: 'Artist A',
            title: 'Song A', artist: 'Artist A',
            stored_isrc: null, stored_spotify_id: null,
            isrc: null, spotify_id: null, thumbnail_url: null,
            latest_like_count: 42, latest_observed_at: NOW,
          }] };
        },
        async first() { return { track_count: 1, max_like_count: 42, latest_observed_at: NOW }; },
        async run() { throw new Error('ranking publication must not write to D1'); },
      };
    },
  };
  let saved = null;
  const result = await publishTrackRankingStatus({
    db, now: NOW, loadRanking: loadTrackRanking,
    upload(key, envelope) { saved = { key, envelope }; return 'actions-status-key'; },
  });
  assert.equal(result.object_key, 'actions-status-key');
  assert.equal(result.track_count, 1);
  assert.equal(saved.key, 'track-history-status');
  assert.equal(saved.envelope.updated_at, NOW);
  assert.equal(saved.envelope.cadence_seconds, 6 * 60 * 60);
  const body = JSON.parse(saved.envelope.body);
  assert.equal(body.ranking[0].title, 'Song A');
  assert.equal(body.ranking_summary.track_count, 1);
  assert.equal(queries.length, 3);
  const canonicalQueries = queries.filter((sql) => /FROM sh_track_canonical_metadata/.test(sql));
  assert.equal(canonicalQueries.length, 1);
  assert.match(canonicalQueries[0], /WHERE track_id IN/);
});
