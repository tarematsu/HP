import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  onRequestGet,
  spotifyArtist,
  spotifyPlaycountSql,
  spotifyReadModel,
} from '../functions/api/spotify-playcounts.js';
import {
  canonicalApiCacheRequest,
  materializedApiKey,
} from '../functions/lib/api-contract.js';

function mockDb(rows) {
  return {
    prepare(sql) {
      assert.equal(sql, spotifyPlaycountSql());
      return {
        async all() {
          return { results: rows };
        },
      };
    },
  };
}

function row(artistKey, trackId, playcount, delta) {
  return {
    artist_key: artistKey,
    snapshot_date: '2026-09-27',
    track_id: trackId,
    name: `Song ${trackId}`,
    playcount,
    delta,
    collected_at: 1_800_000_000_000,
    is_carried_forward: 0,
  };
}

test('Spotify artist helpers support all three groups', () => {
  assert.deepEqual(spotifyArtist(), { key: 'sakurazaka46', name: '櫻坂46' });
  assert.deepEqual(spotifyArtist('nogizaka46'), { key: 'nogizaka46', name: '乃木坂46' });
  assert.deepEqual(spotifyArtist('hinatazaka46'), { key: 'hinatazaka46', name: '日向坂46' });
  assert.equal(spotifyArtist('unknown'), null);
});

test('Spotify read model contains all three groups and server-computed comparison totals', () => {
  const model = spotifyReadModel([
    row('nogizaka46', 'n1', 1000, 100),
    row('nogizaka46', 'n2', 900, 90),
    row('sakurazaka46', 's1', 1200, 120),
    row('hinatazaka46', 'h1', 800, 80),
  ]);
  assert.equal(model.default_artist, 'sakurazaka46');
  assert.equal(model.groups.nogizaka46.track_count, 2);
  assert.equal(model.groups.nogizaka46.total_delta, 190);
  assert.equal(model.groups.sakurazaka46.total_delta, 120);
  assert.equal(model.groups.hinatazaka46.total_delta, 80);
  assert.deepEqual(
    model.comparison.map((item) => [item.artist.key, item.total_delta]),
    [['nogizaka46', 190], ['sakurazaka46', 120], ['hinatazaka46', 80]],
  );
});

test('Spotify API builds one complete read model for R2 publication', async () => {
  const response = await onRequestGet({
    request: new Request('https://pages-materializer.invalid/api/spotify-playcounts'),
    env: {
      OTHER_DB: mockDb([
        row('nogizaka46', 'n1', 100, 5),
        row('sakurazaka46', 's1', 200, 10),
        row('hinatazaka46', 'h1', 300, 15),
      ]),
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.groups.sakurazaka46.tracks[0].playcount, 200);
  assert.equal(payload.comparison.length, 3);
});

test('Spotify public API variants resolve to one materialized R2 model and one cache key', () => {
  assert.equal(materializedApiKey(new URL('https://skrzk.test/api/spotify-playcounts')), 'spotify-playcounts');
  assert.equal(
    materializedApiKey(new URL('https://skrzk.test/api/spotify-playcounts?artist=nogizaka46')),
    'spotify-playcounts',
  );
  const plain = canonicalApiCacheRequest(new Request('https://skrzk.test/api/spotify-playcounts')).url;
  const legacy = canonicalApiCacheRequest(new Request('https://skrzk.test/api/spotify-playcounts?artist=hinatazaka46')).url;
  assert.equal(legacy, plain);
});

test('Spotify API reports missing D1 only on the read-model producer path', async () => {
  const missing = await onRequestGet({
    request: new Request('https://pages-materializer.invalid/api/spotify-playcounts'),
    env: {},
  });
  assert.equal(missing.status, 503);
});

test('Spotify tab mounts comparison chart and fetches the single read model', () => {
  const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

  assert.match(shell, /data-view = 'spotify'|dataset\.view = 'spotify'/);
  assert.match(shell, /data-spotify-artist="nogizaka46"/);
  assert.match(shell, /data-spotify-artist="sakurazaka46" class="active" aria-pressed="true"/);
  assert.match(shell, /data-spotify-artist="hinatazaka46"/);
  assert.match(shell, /id="spotifyComparisonChart"/);
  assert.match(shell, /三坂 前回比合計/);
  assert.match(runtime, /const DEFAULT_ARTIST = 'sakurazaka46'/);
  assert.match(runtime, /fetch\('\/api\/spotify-playcounts'\)/);
  assert.doesNotMatch(runtime, /spotify-playcounts\?artist=/);
  assert.match(runtime, /model\.comparison/);
  assert.match(runtime, /model\?\.groups\?\.\[requested\]/);
  assert.match(tabs, /VIEW_MODES[\s\S]*'spotify'/);
  assert.match(tabs, /const spotifyView = document\.getElementById\('spotifyView'\)/);
  assert.match(tabs, /async function showSpotify/);
  assert.match(tabs, /import\('\/spotify\.js\?v=20260927\.2'\)/);
  assert.match(tabs, /else if \(mode === 'spotify'\) void showSpotify/);
  assert.match(tabs, /button\.dataset\.view === 'spotify'/);
  assert.match(dashboard, /spotify-shell\.js/);
  assert.doesNotMatch(dashboard, /spotify-tab-router/);
});
