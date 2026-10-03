import test from 'node:test';
import assert from 'node:assert/strict';

import {
  spotifyLatestDetailSql,
  spotifyLatestSnapshotDatesSql,
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

test('Sakamichi hot path resolves dates separately then probes tracks through the artist index', () => {
  const datesSql = spotifyLatestSnapshotDatesSql();
  assert.match(datesSql, /SELECT artist_key,MAX\(snapshot_date\) AS snapshot_date/);
  assert.match(datesSql, /GROUP BY artist_key/);

  const detailSql = spotifyLatestDetailSql();
  assert.match(detailSql, /INDEXED BY idx_sh_spotify_track_targets_artist/);
  assert.match(detailSql, /d\.track_id=target\.track_id AND d\.snapshot_date=\?/);
  assert.match(detailSql, /WHERE target\.artist_key=\?/);

  const compatibilitySql = spotifyPlaycountAllSql();
  assert.doesNotMatch(compatibilitySql, /target\.artist_key=latest\.artist_key/);
});
