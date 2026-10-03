import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTitleArtistIdentityRows } from '../src/track-title-artist-identity.js';

test('canonical-only title recovery bypasses the canonical UNION view', async () => {
  const sqlCalls = [];
  const db = {
    prepare(sql) {
      sqlCalls.push(sql);
      return {
        bind() { return this; },
        async all() {
          if (sql.includes('FROM sh_track_dictionary')) {
            return { results: [{
              spotify_id: 'spotify-song',
              isrc: 'JPAAA2600001',
              title: 'Indexed Song',
              artist: '櫻坂46',
              thumbnail_url: 'https://img.example/song.jpg',
              fetched_at: 1,
            }] };
          }
          return { results: [] };
        },
      };
    },
  };

  const rows = await loadTitleArtistIdentityRows(
    db,
    [{ title: 'Indexed Song', artist: '櫻坂46' }],
    80,
    { canonicalOnly: true },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].spotify_id, 'spotify-song');
  assert.equal(sqlCalls.some((sql) => sql.includes('FROM sh_track_canonical_metadata')), false);
  assert.equal(sqlCalls.some((sql) => sql.includes('FROM sh_tracks')), true);
  assert.equal(sqlCalls.some((sql) => sql.includes('FROM sh_track_dictionary')), true);
  assert.ok(sqlCalls
    .filter((sql) => sql.includes('FROM sh_tracks') || sql.includes('FROM sh_track_dictionary'))
    .every((sql) => sql.includes('TRIM(title) COLLATE NOCASE IN')));
});
