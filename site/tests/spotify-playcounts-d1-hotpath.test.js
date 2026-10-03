import test from 'node:test';
import assert from 'node:assert/strict';

import {
  spotifyPlaycountAllSql,
  spotifyPlaycountSql,
} from '../functions/api/spotify-playcounts.js';

test('Spotify latest snapshot lookup uses the materialized artist daily summary', () => {
  const single = spotifyPlaycountSql();
  const all = spotifyPlaycountAllSql();

  for (const sql of [single, all]) {
    assert.match(sql, /FROM sh_spotify_artist_daily/);
    assert.doesNotMatch(
      sql,
      /SELECT[^`]*MAX\(d\.snapshot_date\)[^`]*FROM sh_spotify_playcount_daily/s,
      'latest-date resolution must not scan the playcount history table',
    );
  }
});

test('Sakamichi lookup keeps independent latest dates per artist', () => {
  const sql = spotifyPlaycountAllSql();
  assert.match(sql, /SELECT artist_key,MAX\(snapshot_date\) AS snapshot_date/);
  assert.match(sql, /GROUP BY artist_key/);
});
