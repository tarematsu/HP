import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  spotifyPlaycountAllSql,
  spotifyReadModelAll,
} from '../functions/api/spotify-playcounts.js';

function row(artistKey, trackId, name, playcount, delta, snapshotDate) {
  return {
    artist_key: artistKey,
    snapshot_date: snapshotDate,
    track_id: trackId,
    spotify_track_id: `spotify-${trackId}`,
    name,
    playcount,
    delta,
    collected_at: 1_800_000_000_000,
    is_carried_forward: 0,
  };
}

test('Sakamichi Spotify read model keeps each artist latest detail and sorts tracks by delta', () => {
  const model = spotifyReadModelAll([
    row('sakurazaka46', 1, 'S2', 200, 20, '2026-09-30'),
    row('sakurazaka46', 2, 'S1', 100, 30, '2026-09-30'),
    row('nogizaka46', 3, 'N2', 400, 40, '2026-10-01'),
    row('nogizaka46', 4, 'N1', 300, 50, '2026-10-01'),
    row('hinatazaka46', 5, 'H2', 600, 60, '2026-09-29'),
    row('hinatazaka46', 6, 'H1', 500, 70, '2026-09-29'),
  ], [], []);

  assert.deepEqual(Object.keys(model.groups), ['sakurazaka46', 'nogizaka46', 'hinatazaka46']);
  assert.equal(model.groups.sakurazaka46.snapshot_date, '2026-09-30');
  assert.equal(model.groups.nogizaka46.snapshot_date, '2026-10-01');
  assert.equal(model.groups.hinatazaka46.snapshot_date, '2026-09-29');
  assert.deepEqual(model.groups.sakurazaka46.tracks.map((track) => track.delta), [30, 20]);
  assert.deepEqual(model.groups.nogizaka46.tracks.map((track) => track.delta), [50, 40]);
  assert.deepEqual(model.groups.hinatazaka46.tracks.map((track) => track.delta), [70, 60]);
});

test('Sakamichi detail SQL selects latest date independently per artist', () => {
  const sql = spotifyPlaycountAllSql();
  assert.match(sql, /target\.artist_key IN \('sakurazaka46','nogizaka46','hinatazaka46'\)/);
  assert.match(sql, /GROUP BY target\.artist_key/);
  assert.match(sql, /d\.snapshot_date=latest\.snapshot_date/);
  assert.match(sql, /d\.delta DESC/);
});

test('Spotify detail UI switches the shared table between all three Sakamichi groups', () => {
  const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
  const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');

  assert.match(shell, /dashboardModeTabs/);
  assert.match(shell, /value: 'sakurazaka46', label: '櫻坂46', active: true/);
  assert.match(shell, /value: 'nogizaka46', label: '乃木坂46'/);
  assert.match(shell, /value: 'hinatazaka46', label: '日向坂46'/);
  assert.match(shell, /dataAttribute: 'spotify-artist'/);
  assert.match(sharedUi, /data-\$\{attribute\}="\$\{item\.value\}"/);
  assert.match(runtime, /let selectedArtistKey = 'sakurazaka46'/);
  assert.match(runtime, /model\?\.groups\?\.\[selectedArtistKey\]/);
  assert.match(runtime, /selectedArtistKey = button\.dataset\.spotifyArtist/);
  assert.match(runtime, /`\$\{artistName\}の再生数一覧`/);
});