import assert from 'node:assert/strict';
import test from 'node:test';
import { SPOTIFY_JP_CHARTS, spotifyChartModelKey } from '../../packages/sh-shared/spotify-charts.mjs';
import { normalizeJapanChart } from '../src/spotify-japan-chart-data.js';
import { runJapanChartWork, enqueueJapanCharts, SPOTIFY_CHART_WORK } from '../src/spotify-japan-charts.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import { PUBLIC_R2_MODEL_KEYS, modelMaximumAge } from '../src/pages-response-models.js';
import { materializedApiKey } from '../../packages/sh-shared/api-contract.mjs';

const spec = SPOTIFY_JP_CHARTS.find(item => item.id === 'regional-jp-daily');
function payload(date = '2026-10-14', type = 'regional') {
  return { displayChart: { date, chartMetadata: { dimensions: { earliestDate: '2026-10-11' } } }, entries: Array.from({ length: 50 }, (_, i) => ({
    chartEntryData: { currentRank: i + 1, previousRank: 2, peakRank: 1, rankingMetric: { type: 'STREAMS', value: '12345' } },
    ...(type === 'artist' ? { artistMetadata: { artistName: i ? 'Other' : '坂道選抜', artistUri: `spotify:artist:${i ? `other${i}` : '44VXOtivzQwdqj1Xs80SaX'}` } }
      : { [type === 'album' ? 'albumMetadata' : 'trackMetadata']: {
        [type === 'album' ? 'albumName' : 'trackName']: `Song ${i}`,
        [type === 'album' ? 'albumUri' : 'trackUri']: `spotify:${type === 'album' ? 'album' : 'track'}:track${i}`,
        artists: [{ name: i ? 'Other' : '櫻坂46', spotifyUri: `spotify:artist:${i ? `other${i}` : '0Ti7MfCiVVQAK8zLSiqlto'}` }],
      } }),
  })) };
}
function bucket() {
  const values = new Map();
  return { values, async get(key) { const value = values.get(key); return value ? { json: async () => JSON.parse(value), text: async () => value } : null; },
    async delete(key) { values.delete(key); }, async put(key, value) { values.set(key, value); } };
}
function harness(fetchChart) {
  const r2 = bucket(); const messages = [];
  const env = { PAGES_RESPONSE_R2: r2, SPOTIFY_CHARTS_REFRESH_TOKEN: 'private-test', SPOTIFY_PLAYCOUNT_QUEUE: { async send(body, options) { messages.push({ body, options }); } } };
  const fetchImpl = async url => String(url).includes('accounts.spotify.com') ? Response.json({ access_token: 'private-access' }) : fetchChart(String(url));
  return { env, r2, messages, fetchImpl };
}
const work = mode => ({ message_type: SPOTIFY_CHART_WORK, message_version: 1, chart_id: spec.id, mode });

test('normalizes official Charts metadata, artist Spotify URIs and stream rankingMetric', () => {
  const capture = normalizeJapanChart(payload(), spec);
  assert.equal(capture.chart_date, '2026-10-14');
  assert.equal(capture.source_start, '2026-10-11');
  assert.equal(capture.entries.length, 1);
  assert.deepEqual(capture.entries[0].artists, ['sakurazaka46']);
  assert.equal(capture.entries[0].streams, 12345);
  assert.throws(() => normalizeJapanChart(payload(), spec, '2026-10-13'), /date/);
  assert.throws(() => normalizeJapanChart({ ...payload(), entries: [] }, spec), /entries/);
});

test('supports album credits, Sakamichi Selection, name fallback and explicit-ID precedence', () => {
  for (const type of ['artist', 'album', 'viral']) {
    const s = SPOTIFY_JP_CHARTS.find(item => item.type === type);
    const capture = normalizeJapanChart(payload('2026-10-14', type), s);
    assert.deepEqual(capture.entries[0].artists, [type === 'artist' ? 'sakamichi-selection' : 'sakurazaka46']);
    assert.equal(capture.entries[0].streams, null);
  }
  const raw = payload(); raw.entries[0].trackMetadata.artists[0].spotifyUri = 'spotify:artist:unrelated';
  assert.equal(normalizeJapanChart(raw, spec).entries.length, 0);
  delete raw.entries[0].trackMetadata.artists[0].spotifyUri;
  assert.equal(normalizeJapanChart(raw, spec).entries.length, 1);
});

test('valid empty tracked results differ from unavailable or malformed source responses', async () => {
  const h = harness(async url => url.endsWith('/latest') ? new Response(null, { status: 404 }) : Response.json(payload()));
  await runJapanChartWork(h.env, work('latest'), h);
  const index = JSON.parse(h.r2.values.get(pagesR2ResponseKey('spotify-charts')));
  assert.equal(index.charts.find(c => c.chart_id === spec.id).status, 'unavailable');
  assert.equal(h.messages.length, 0);
  const raw = payload(); for (const row of raw.entries) row.trackMetadata.artists = [{ name: 'Other', spotifyUri: 'spotify:artist:other' }];
  assert.deepEqual(normalizeJapanChart(raw, spec).entries, []);
  raw.entries[0].chartEntryData.currentRank = 0;
  assert.throws(() => normalizeJapanChart(raw, spec), /Malformed/);
});

test('latest ingestion publishes a bounded year model and a resumable 30-second backfill', async () => {
  const h = harness(async url => Response.json(payload(url.endsWith('/latest') ? '2026-10-14' : url.split('/').at(-1))));
  await runJapanChartWork(h.env, work('latest'), h);
  assert.equal(h.messages[0].options.delaySeconds, 30);
  assert.equal(h.messages[0].body.cursor, '2026-10-13');
  const key = pagesR2ResponseKey(spotifyChartModelKey(spec.id, '2026'));
  let model = JSON.parse(h.r2.values.get(key));
  assert.equal(model.periods.length, 1);
  await runJapanChartWork(h.env, h.messages[0].body, h);
  model = JSON.parse(h.r2.values.get(key));
  assert.deepEqual(model.periods.map(p => p.chart_date), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  const state = JSON.parse(h.r2.values.get(`spotify/charts/state/${spec.id}.json`));
  assert.equal(state.history_complete, true);
  const previous = h.r2.values.get(key);
  await runJapanChartWork(h.env, h.messages[0].body, h);
  assert.equal(h.r2.values.get(key), previous);
});

test('404 historical dates stay missing and HTTP 429 does not advance their cursor', async () => {
  const h = harness(async url => url.endsWith('/latest') ? Response.json(payload()) : new Response(null, { status: 429, headers: { 'retry-after': '120' } }));
  await runJapanChartWork(h.env, work('latest'), h);
  await assert.rejects(runJapanChartWork(h.env, h.messages[0].body, h), /HTTP 429/);
  assert.equal(JSON.parse(h.r2.values.get(`spotify/charts/state/${spec.id}.json`)).cursor, '2026-10-13');
  h.fetchImpl = async url => String(url).includes('accounts.spotify.com') ? Response.json({ access_token: 'x' }) : new Response(null, { status: 404 });
  await runJapanChartWork(h.env, h.messages[0].body, h);
  const model = JSON.parse(h.r2.values.get(pagesR2ResponseKey(spotifyChartModelKey(spec.id, '2026'))));
  assert.equal(model.periods.length, 1);
});

test('all seven series enqueue without reading Spotify or D1; public keys are bounded', async () => {
  const h = harness(() => { throw new Error('No network in dispatcher'); });
  await enqueueJapanCharts(h.env);
  assert.equal(h.messages.length, 7);
  assert.equal(materializedApiKey('https://example.test/api/spotify-charts?chart=regional-jp-daily&year=2026'), 'spotify-charts:regional-jp-daily:2026');
  assert.equal(materializedApiKey('https://example.test/api/spotify-charts?chart=bad&year=2026'), null);
  for (const key of ['spotify-charts', 'spotify-charts:album-jp-weekly:2021']) {
    assert.equal(PUBLIC_R2_MODEL_KEYS.has(key), true);
    assert.equal(modelMaximumAge(key, {}), Number.MAX_SAFE_INTEGER);
  }
});

 test('history reuses a short-lived private access session without storing a refresh token', async () => {
  let refreshes = 0;
  const h = harness(async url => Response.json(payload(url.endsWith('/latest') ? '2026-10-14' : url.split('/').at(-1))));
  const base = h.fetchImpl;
  h.fetchImpl = async (...args) => { if (String(args[0]).includes('accounts.spotify.com')) refreshes++; return base(...args); };
  await runJapanChartWork(h.env, work('latest'), h);
  await runJapanChartWork(h.env, h.messages[0].body, h);
  assert.equal(refreshes, 1);
  const cache = JSON.parse(h.r2.values.get('spotify/charts/private/access-session.json'));
  assert.equal(cache.access_token, 'private-access');
  assert.equal(JSON.stringify(cache).includes('private-test'), false);
  assert.equal(PUBLIC_R2_MODEL_KEYS.has('spotify/charts/private/access-session.json'), false);
});
