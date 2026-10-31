import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSpotifyPlaylistPositions } from '../src/spotify-playlist-collector.js';
import { runJapanChartWork, enqueueJapanCharts, SPOTIFY_VIRAL_HITS_JAPAN_URL } from '../src/spotify-japan-charts.js';
import { spotifyChartModelKey, SPOTIFY_EDITORIAL_PLAYLISTS } from '../../packages/sh-shared/spotify-charts.mjs';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

const PLAYLIST_ID = '37i9dQZF1DWZZbpkxU5t9L';
const TRACK = index => String(index).padStart(22, '0');
function embed(artistAt = [2, 23, 60], customize = null) {
  const trackList = Array.from({ length: 60 }, (_, i) => ({
    uri: `spotify:track:${TRACK(i + 1)}`,
    title: `Track ${i + 1}`,
    subtitle: 'Other Artist',
  }));
  trackList[artistAt[0] - 1] = { ...trackList[artistAt[0] - 1], artistUri: 'spotify:artist:0Ti7MfCiVVQAK8zLSiqlto', subtitle: '櫻坂46' };
  trackList[artistAt[1] - 1] = { ...trackList[artistAt[1] - 1], artistUri: 'spotify:artist:08lN7bm4Etec8ETFxaTUmq', subtitle: '乃木坂46' };
  trackList[artistAt[2] - 1] = { ...trackList[artistAt[2] - 1], artistUri: 'spotify:artist:0eQSoTI7sQENREQM8Klp2j', subtitle: '日向坂46' };
  trackList[29] = { ...trackList[29], contributors: [
    { uri: 'spotify:artist:0Ti7MfCiVVQAK8zLSiqlto' },
    { uri: 'spotify:artist:44VXOtivzQwdqj1Xs80SaX' },
  ], subtitle: '櫻坂46, 坂道選抜' };
  // An explicit unrelated artist ID must win over a misleading display name.
  trackList[30] = { ...trackList[30], artistUri: 'spotify:artist:1234567890ABCDEFGHIJKL', subtitle: '櫻坂46' };
  customize?.(trackList);
  return '<!doctype html><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({
    props: { pageProps: { state: { data: { entity: { title: 'Viral Hits Japan', subtitle: 'Spotify',
      trackList } } } } },
  }) + '</script>';
}
class Bucket {
  constructor() { this.values = new Map(); }
  async get(key) { const value = this.values.get(key); return value == null ? null : { json: async () => JSON.parse(value) }; }
  async put(key, value) { this.values.set(key, String(value)); }
  async delete(key) { this.values.delete(key); }
}
function harness(t) {
  const r2 = new Bucket();
  const messages = [];
  const requests = [];
  const env = {
    PAGES_RESPONSE_R2: r2,
    SPOTIFY_PLAYCOUNT_QUEUE: { async send(body, options) { messages.push({ body, options }); } },
    get SPOTIFY_CHARTS_REFRESH_TOKEN() { throw new Error('Public playlist must not need OAuth'); },
  };
  let clock = Date.UTC(2026, 9, 16, 0, 20);
  // Collection observations and persisted write cooldowns use the same clock.
  t.mock.method(Date, 'now', () => clock);
  const deps = { now: () => clock, fetchImpl: async url => {
    requests.push(String(url));
    if (!String(url).startsWith('https://open.spotify.com/embed/playlist/')) throw new Error('unexpected source');
    return new Response(embed(), { status: 200, headers: { 'content-type': 'text/html' } });
  } };
  return { r2, env, deps, requests, messages, advance: () => { clock += 86400000; } };
}
const work = () => ({ message_version: 1, mode: 'latest', chart_id: 'viral-hits-jp-daily' });

test('official Viral Hits playlist rows retain original 1-based positions including unrelated songs', () => {
  const model = parseSpotifyPlaylistPositions(embed(), SPOTIFY_VIRAL_HITS_JAPAN_URL);
  assert.equal(model.id, PLAYLIST_ID);
  assert.equal(model.total, 60);
  assert.deepEqual(model.tracks.map(entry => entry.rank), [2, 23, 30, 60]);
  assert.deepEqual(model.tracks.map(entry => entry.artists), [
    ['sakurazaka46'], ['nogizaka46'], ['sakurazaka46', 'sakamichi-selection'], ['hinatazaka46'],
  ]);
  assert.equal(model.tracks[0].id, TRACK(2));
  assert.equal(model.tracks[1].streams, null);
});

test('English Spotify artist names still match when unrelated album metadata carries another artist ID', () => {
  const html = embed([], trackList => {
    const unrelatedAlbumArtist = 'spotify:artist:1234567890ABCDEFGHIJKL';
    trackList[0] = { ...trackList[0], subtitle: 'Sakurazaka46', album: { artistUri: unrelatedAlbumArtist } };
    trackList[1] = { ...trackList[1], subtitle: 'Nogizaka46', album: { artistUri: unrelatedAlbumArtist } };
    trackList[2] = { ...trackList[2], subtitle: 'Hinatazaka46', album: { artistUri: unrelatedAlbumArtist } };
    trackList[3] = { ...trackList[3], subtitle: 'Sakamichi Selection', album: { artistUri: unrelatedAlbumArtist } };
  });
  const model = parseSpotifyPlaylistPositions(html, SPOTIFY_VIRAL_HITS_JAPAN_URL);
  assert.deepEqual(model.tracks.map(row => [row.rank, row.artists]), [
    [1, ['sakurazaka46']],
    [2, ['nogizaka46']],
    [3, ['hinatazaka46']],
    [4, ['sakamichi-selection']],
    [30, ['sakurazaka46', 'sakamichi-selection']],
  ]);
});

test('primary artist objects and raw Spotify artist IDs are recognized', () => {
  const html = embed([], trackList => {
    trackList[0] = { ...trackList[0], artists: [{ id: '0Ti7MfCiVVQAK8zLSiqlto', name: 'Sakurazaka46' }] };
    trackList[1] = { ...trackList[1], artist: { uri: 'spotify:artist:08lN7bm4Etec8ETFxaTUmq', name: 'Nogizaka46' } };
  });
  const model = parseSpotifyPlaylistPositions(html, SPOTIFY_VIRAL_HITS_JAPAN_URL);
  assert.deepEqual(model.tracks.map(row => [row.rank, row.artists]), [
    [1, ['sakurazaka46']],
    [2, ['nogizaka46']],
    [30, ['sakurazaka46', 'sakamichi-selection']],
  ]);
});

test('malformed and missing public embeds fail rather than recording false absence', () => {
  assert.throws(() => parseSpotifyPlaylistPositions('<html>missing</html>', SPOTIFY_VIRAL_HITS_JAPAN_URL), /no complete track list/);
  assert.throws(() => parseSpotifyPlaylistPositions(embed(), 'https://example.com/playlist/' + PLAYLIST_ID), /no complete track list/);
});

test('playlist publisher saves daily snapshots in existing year shards and publishes no backfill jobs', async (t) => {
  const h = harness(t);
  assert.equal(SPOTIFY_EDITORIAL_PLAYLISTS.find(item => item.id === 'viral-hits-jp-daily').source, 'spotify-playlist-position');
  await runJapanChartWork(h.env, work(), h.deps);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0], 'https://open.spotify.com/embed/playlist/' + PLAYLIST_ID);
  let state = JSON.parse(h.r2.values.get('spotify/charts/state/viral-hits-jp-daily.json'));
  assert.equal(state.latest_chart_date, '2026-10-16');
  assert.equal(state.history_complete, true);
  assert.equal(state.playlist_total, 60);
  assert.equal(state.source, 'spotify-playlist-position');
  assert.equal(h.messages.filter(item => item.body.mode === 'history').length, 0);
  const key = pagesR2ResponseKey(spotifyChartModelKey('viral-hits-jp-daily', '2026'));
  let model = JSON.parse(h.r2.values.get(key));
  assert.equal(model.periods.length, 1);
  assert.equal(model.periods[0].entries[0].rank, 2);
  h.advance();
  await runJapanChartWork(h.env, work(), h.deps);
  model = JSON.parse(h.r2.values.get(key));
  assert.deepEqual(model.periods.map(period => period.chart_date), ['2026-10-16', '2026-10-17']);
  assert.equal(h.messages.filter(item => item.body.mode === 'history').length, 0);
});

test('fetch or parser failure preserves the last good playlist ranking snapshot', async (t) => {
  const h = harness(t);
  await runJapanChartWork(h.env, work(), h.deps);
  h.advance();
  h.deps.fetchImpl = async () => new Response('Forbidden', { status: 403 });
  await assert.rejects(runJapanChartWork(h.env, work(), h.deps), /HTTP 403/);
  const state = JSON.parse(h.r2.values.get('spotify/charts/state/viral-hits-jp-daily.json'));
  assert.equal(state.latest_chart_date, '2026-10-16');
  const model = JSON.parse(h.r2.values.get(pagesR2ResponseKey(spotifyChartModelKey('viral-hits-jp-daily', '2026'))));
  assert.equal(model.periods.length, 1);
});

test('all sixteen editorial playlists are scheduled and their positions stay separate by playlist ID', async (t) => {
  const h = harness(t);
  await enqueueJapanCharts(h.env);
  assert.equal(SPOTIFY_EDITORIAL_PLAYLISTS.length, 16);
  assert.deepEqual(
    h.messages.filter(item => SPOTIFY_EDITORIAL_PLAYLISTS.some(source => source.id === item.body.chart_id))
      .map(item => item.body.chart_id),
    SPOTIFY_EDITORIAL_PLAYLISTS.map(source => source.id),
  );
  const first = SPOTIFY_EDITORIAL_PLAYLISTS[0];
  const last = SPOTIFY_EDITORIAL_PLAYLISTS.at(-1);
  await runJapanChartWork(h.env, { ...work(), chart_id: first.id }, h.deps);
  await runJapanChartWork(h.env, { ...work(), chart_id: last.id }, h.deps);
  assert.equal(h.requests[0], 'https://open.spotify.com/embed/playlist/' + first.playlistId);
  assert.equal(h.requests[1], 'https://open.spotify.com/embed/playlist/' + last.playlistId);
  for (const item of [first, last]) {
    const state = JSON.parse(h.r2.values.get('spotify/charts/state/' + item.id + '.json'));
    assert.equal(state.playlist_url, item.url);
    assert.equal(state.playlist_total, 60);
    const shard = JSON.parse(h.r2.values.get(pagesR2ResponseKey(spotifyChartModelKey(item.id, '2026'))));
    assert.equal(shard.periods[0].entries[0].rank, 2);
  }
  assert.notEqual(first.id, last.id);
});

test('podcast episodes retain their row offset but do not prevent new-release playlist captures', () => {
  const id = SPOTIFY_EDITORIAL_PLAYLISTS.find(item => item.slug === 'new-music-wednesday');
  const html = embed().replace(
    '"uri":"spotify:track:0000000000000000000001"',
    '"uri":"spotify:episode:0000000000000000000001"',
  );
  const playlist = parseSpotifyPlaylistPositions(html, id.url);
  assert.equal(playlist.total, 60);
  assert.deepEqual(playlist.tracks.map(row => row.rank), [2, 23, 30, 60]);
});
