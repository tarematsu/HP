import assert from 'node:assert/strict';
import test from 'node:test';
import { SPOTIFY_JP_CHARTS, spotifyChartModelKey } from '../../packages/sh-shared/spotify-charts.mjs';
import { normalizeJapanChart } from '../src/spotify-japan-chart-data.js';
import { runJapanChartWork, processJapanChartMessage, enqueueJapanCharts, SPOTIFY_CHART_WORK } from '../src/spotify-japan-charts.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import { PUBLIC_R2_MODEL_KEYS, modelMaximumAge } from '../src/pages-response-models.js';
import { materializedApiKey } from '../../packages/sh-shared/api-contract.mjs';
import { enqueueSpotifyScheduledDispatch, processSpotifyScheduledDispatchEntry } from '../src/spotify-scheduled-queue.js';
import { SPOTIFY_ARTIST_CHART_CRON } from '../src/scheduled-crons.js';

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
  let clock = Date.now();
  return { env, r2, messages, fetchImpl, now: () => (clock += 31000) };
}
const historyMessage = h => h.messages.findLast(item => item.body.mode === 'history');
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
  await runJapanChartWork(h.env, h.messages.find(item => item.body.mode === 'publish').body, h);
  const index = JSON.parse(h.r2.values.get(pagesR2ResponseKey('spotify-charts')));
  assert.equal(index.charts.find(c => c.chart_id === spec.id).status, 'unavailable');
  assert.equal(h.messages.some(item => item.body.mode === 'history'), false);
  const raw = payload(); for (const row of raw.entries) row.trackMetadata.artists = [{ name: 'Other', spotifyUri: 'spotify:artist:other' }];
  assert.deepEqual(normalizeJapanChart(raw, spec).entries, []);
  raw.entries[0].chartEntryData.currentRank = 0;
  assert.throws(() => normalizeJapanChart(raw, spec), /Malformed/);
});

test('latest ingestion publishes a bounded year model and a resumable 30-second backfill', async () => {
  const h = harness(async url => Response.json(payload(url.endsWith('/latest') ? '2026-10-14' : url.split('/').at(-1))));
  await runJapanChartWork(h.env, work('latest'), h);
  assert.equal(historyMessage(h).options.delaySeconds, 30);
  assert.equal(historyMessage(h).body.cursor, '2026-10-13');
  const key = pagesR2ResponseKey(spotifyChartModelKey(spec.id, '2026'));
  let model = JSON.parse(h.r2.values.get(key));
  assert.equal(model.periods.length, 1);
  for (let i = 0; i < 3; i++) await runJapanChartWork(h.env, historyMessage(h).body, h);
  model = JSON.parse(h.r2.values.get(key));
  assert.deepEqual(model.periods.map(p => p.chart_date), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  const state = JSON.parse(h.r2.values.get(`spotify/charts/state/${spec.id}.json`));
  assert.equal(state.history_complete, true);
  const previous = h.r2.values.get(key);
  await runJapanChartWork(h.env, historyMessage(h).body, h);
  assert.equal(h.r2.values.get(key), previous);
});

test('404 historical dates stay missing and HTTP 429 does not advance their cursor', async () => {
  const h = harness(async url => url.endsWith('/latest') ? Response.json(payload()) : new Response(null, { status: 429, headers: { 'retry-after': '120' } }));
  await runJapanChartWork(h.env, work('latest'), h);
  await assert.rejects(runJapanChartWork(h.env, historyMessage(h).body, h), /HTTP 429/);
  assert.equal(JSON.parse(h.r2.values.get(`spotify/charts/state/${spec.id}.json`)).cursor, '2026-10-13');
  h.fetchImpl = async url => String(url).includes('accounts.spotify.com') ? Response.json({ access_token: 'x' }) : new Response(null, { status: 404 });
  await runJapanChartWork(h.env, historyMessage(h).body, h);
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
  await runJapanChartWork(h.env, historyMessage(h).body, h);
  assert.equal(refreshes, 1);
  const cache = JSON.parse(h.r2.values.get('spotify/charts/private/access-session.json'));
  assert.equal(cache.access_token, 'private-access');
  assert.equal(JSON.stringify(cache).includes('private-test'), false);
  assert.equal(PUBLIC_R2_MODEL_KEYS.has('spotify/charts/private/access-session.json'), false);
});

test('Viral latest 404 enqueues bounded archive discovery instead of prematurely declaring unavailability', async () => {
  const calls = [];
  const h = harness(async url => { calls.push(url); return new Response(null, { status: 404 }); });
  const latest = { ...work('latest'), chart_id: 'viral-jp-daily' };
  await runJapanChartWork(h.env, latest, h);
  assert.equal(calls.length, 1, 'latest 404 must not make dozens of archive requests synchronously');
  assert.equal(calls[0].endsWith('/latest'), true);
  let state = JSON.parse(h.r2.values.get('spotify/charts/state/viral-jp-daily.json'));
  assert.equal(state.status, 'searching');
  assert.equal(state.latest_chart_date, null);
  assert.equal(h.messages.find(item => item.body.mode === 'archive').body.cursor, '2026-05-14');
  // Old deployments stored archive_probed=true after only three failed dates;
  // that legacy flag must not disable the new checkpointed search.
  state.archive_probed = true;
  h.r2.values.set('spotify/charts/state/viral-jp-daily.json', JSON.stringify(state));
  for (let i = 0; i < 8; i++) await runJapanChartWork(h.env, h.messages.findLast(item => item.body.mode === 'archive').body, h);
  state = JSON.parse(h.r2.values.get('spotify/charts/state/viral-jp-daily.json'));
  assert.equal(state.archive_probes_attempted, 8);
  assert.equal(state.status, 'searching');
  assert.equal(state.archive_search_complete, false);
  assert.equal(calls.length, 9);
  assert.equal(h.messages.filter(item => item.body.mode === 'history').length, 0);
  assert.equal(h.messages.findLast(item => item.body.mode === 'archive').body.cursor, '2020-05-14');
});

test('accessible old Viral dates seed an ordinary history backfill even after archived latest 404', async () => {
  const h = harness(async url => {
    if (!url.endsWith('/2020-05-14')) return new Response(null, { status: 404 });
    const data = payload('2020-05-14', 'viral');
    data.displayChart.chartMetadata.dimensions.earliestDate = '2017-01-01';
    return Response.json(data);
  });
  const latest = { ...work('latest'), chart_id: 'viral-jp-daily' };
  await runJapanChartWork(h.env, latest, h);
  for (let i = 0; i < 8; i++) await runJapanChartWork(h.env, h.messages.findLast(item => item.body.mode === 'archive').body, h);
  const state = JSON.parse(h.r2.values.get('spotify/charts/state/viral-jp-daily.json'));
  assert.equal(state.status, 'archived');
  assert.equal(state.latest_chart_date, '2020-05-14');
  assert.deepEqual(state.years, ['2020']);
  assert.equal(state.archive_found, true);
  assert.equal(state.archive_search_complete, true);
  assert.equal(historyMessage(h).body.cursor, '2020-05-13');
  const shard = JSON.parse(h.r2.values.get(pagesR2ResponseKey(spotifyChartModelKey('viral-jp-daily', '2020'))));
  assert.equal(shard.periods[0].entries[0].artists[0], 'sakurazaka46');
  await runJapanChartWork(h.env, latest, h);
  assert.equal(h.messages.findLast(item => item.body.mode === 'archive').body.cursor, '2020-05-14', 'old archive work must not restart');
});

test('Viral archive 429 preserves the checkpoint for a later retry', async () => {
  const h = harness(async url => url.endsWith('/latest')
    ? new Response(null, { status: 404 })
    : new Response(null, { status: 429, headers: { 'retry-after': '180' } }));
  await runJapanChartWork(h.env, { ...work('latest'), chart_id: 'viral-jp-weekly' }, h);
  const archive = h.messages.findLast(item => item.body.mode === 'archive').body;
  assert.equal(archive.cursor, '2026-05-07');
  await assert.rejects(runJapanChartWork(h.env, archive, h), /HTTP 429/);
  const state = JSON.parse(h.r2.values.get('spotify/charts/state/viral-jp-weekly.json'));
  assert.equal(state.archive_probes_attempted, undefined);
  assert.equal(state.archive_probe_index, undefined);
  assert.equal(state.archive_search_complete, false);
});

test('Viral archive handoff errors resume the committed next date without fetching a stale date twice', async () => {
  const h = harness(async () => new Response(null, { status: 404 }));
  await runJapanChartWork(h.env, { ...work('latest'), chart_id: 'viral-jp-weekly' }, h);
  const first = h.messages.findLast(item => item.body.mode === 'archive').body;
  const send = h.env.SPOTIFY_PLAYCOUNT_QUEUE.send.bind(h.env.SPOTIFY_PLAYCOUNT_QUEUE);
  let fail = true;
  h.env.SPOTIFY_PLAYCOUNT_QUEUE.send = async (message, opts) => {
    if (message.mode === 'archive' && fail) { fail = false; throw new Error('Queue handoff interrupted'); }
    return send(message, opts);
  };
  let acked = 0, retried = 0;
  await processJapanChartMessage({ body: first, ack: () => acked++, retry: () => retried++ }, h.env, h);
  assert.equal(acked, 1);
  assert.equal(retried, 0);
  const state = JSON.parse(h.r2.values.get('spotify/charts/state/viral-jp-weekly.json'));
  assert.equal(state.archive_probes_attempted, 1);
  assert.equal(h.messages.findLast(item => item.body.mode === 'archive').body.cursor, '2026-02-12');
  // A duplicate old Queue message is harmless.
  await runJapanChartWork(h.env, first, h);
  assert.equal(JSON.parse(h.r2.values.get('spotify/charts/state/viral-jp-weekly.json')).archive_probes_attempted, 1);
});

test('each source invocation writes each R2 key at most once', async () => {
  const h = harness(async url => Response.json(payload(url.endsWith('/latest') ? '2026-10-14' : url.split('/').at(-1))));
  const put = h.r2.put.bind(h.r2);
  const counts = new Map();
  h.r2.put = async (key, value, options) => {
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    assert.equal(count <= 1, true, `R2 same-key write budget exceeded: ${key}`);
    return put(key, value, options);
  };
  await runJapanChartWork(h.env, work('latest'), h);
  counts.clear();
  await runJapanChartWork(h.env, historyMessage(h).body, h);
  const model = JSON.parse(h.r2.values.get(pagesR2ResponseKey(spotifyChartModelKey(spec.id, '2026'))));
  assert.equal(model.periods.length, 2);
  assert.equal(h.messages.some(item => item.body.mode === 'publish'), true);
});

test('index publication coalesces updates for 30 seconds and acknowledges covered requests', async () => {
  const h = harness(() => { throw new Error('Publication must not call Spotify'); });
  const key = pagesR2ResponseKey('spotify-charts');
  h.r2.values.set(key, JSON.stringify({ ok: true, updated_at: 9000, charts: [] }));
  let now = 10000;
  h.now = () => now;
  const message = { ...work('publish'), requested_at: 9500 };
  await runJapanChartWork(h.env, message, h);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].options.delaySeconds, 30);
  assert.equal(JSON.parse(h.r2.values.get(key)).updated_at, 9000);
  now = 40000;
  await runJapanChartWork(h.env, h.messages[0].body, h);
  assert.equal(JSON.parse(h.r2.values.get(key)).updated_at, 40000);
  await runJapanChartWork(h.env, message, h);
  assert.equal(h.messages.length, 1);
});

test('failed publication handoff resumes committed history without rewriting its checkpoint', async () => {
  const h = harness(async url => Response.json(payload(url.endsWith('/latest') ? '2026-10-14' : url.split('/').at(-1))));
  await runJapanChartWork(h.env, work('latest'), h);
  const body = historyMessage(h).body;
  const send = h.env.SPOTIFY_PLAYCOUNT_QUEUE.send.bind(h.env.SPOTIFY_PLAYCOUNT_QUEUE);
  let fail = true;
  h.env.SPOTIFY_PLAYCOUNT_QUEUE.send = async (message, options) => {
    if (message.mode === 'publish' && fail) { fail = false; throw new Error('Queue handoff failed'); }
    return send(message, options);
  };
  const put = h.r2.put.bind(h.r2);
  const counts = new Map();
  h.r2.put = async (key, ...args) => {
    counts.set(key, (counts.get(key) || 0) + 1);
    assert.equal(counts.get(key) <= 1, true, 'a committed checkpoint cannot be rewritten immediately');
    return put(key, ...args);
  };
  let acked = 0, retried = 0;
  await processJapanChartMessage({ body, ack: () => acked++, retry: () => retried++ }, h.env, h);
  const state = JSON.parse(h.r2.values.get(`spotify/charts/state/${spec.id}.json`));
  assert.equal(state.status, 'ok');
  assert.equal(state.cursor, '2026-10-12');
  assert.equal(historyMessage(h).body.cursor, '2026-10-12');
  assert.equal(acked, 1);
  assert.equal(retried, 0);
});

test('new Japan Chart jobs enqueue before an independent legacy collector fails', async () => {
  const messages = [];
  const env = { SPOTIFY_PLAYCOUNT_QUEUE: { async send(body) { messages.push(body); } } };
  const scheduled = new Request('https://worker.example/__internal/scheduled', {
    method: 'POST', body: JSON.stringify({ cron: SPOTIFY_ARTIST_CHART_CRON, scheduled_time: Date.now() }),
  });
  const response = await enqueueSpotifyScheduledDispatch(scheduled, env);
  assert.equal(response.status, 200);
  assert.equal(messages.filter(message => message.message_type === SPOTIFY_CHART_WORK).length, 7);
  const legacy = messages.find(message => message.message_type === 'spotify-scheduled-dispatch');
  assert.ok(legacy);
  let retries = 0;
  await processSpotifyScheduledDispatchEntry({ body: legacy, retry() { retries++; } }, env, {
    runSpotifyArtistChartScheduled: async () => { throw new Error('Legacy chart source unavailable'); },
  });
  assert.equal(retries, 1);
  assert.equal(messages.filter(message => message.message_type === SPOTIFY_CHART_WORK).length, 7);
});

test('a successful history step cannot hide a failure in latest collection', async () => {
  const h = harness(async url => Response.json(payload(url.endsWith('/latest') ? '2026-10-14' : url.split('/').at(-1))));
  await runJapanChartWork(h.env, work('latest'), h);
  const key = `spotify/charts/state/${spec.id}.json`;
  const state = JSON.parse(h.r2.values.get(key));
  state.latest_status = 'error';
  state.status = 'error';
  h.r2.values.set(key, JSON.stringify(state));
  await runJapanChartWork(h.env, historyMessage(h).body, h);
  const updated = JSON.parse(h.r2.values.get(key));
  assert.equal(updated.status, 'error');
  assert.equal(updated.latest_status, 'error');
  assert.equal(updated.history_status, 'ok');
});
