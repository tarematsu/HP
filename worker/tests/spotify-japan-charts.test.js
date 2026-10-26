import assert from 'node:assert/strict';
import test from 'node:test';
import { SPOTIFY_JP_CHARTS, SPOTIFY_CHART_SOURCES, SPOTIFY_EDITORIAL_PLAYLISTS, spotifyChartModelKey } from '../../packages/sh-shared/spotify-charts.mjs';
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
  for (const type of ['artist', 'album']) {
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

test('five charts plus sixteen playlists enqueue without reading Spotify or D1; retired keys are rejected', async () => {
  const h = harness(() => { throw new Error('No network in dispatcher'); });
  await enqueueJapanCharts(h.env);
  assert.deepEqual(h.messages.map(item => item.body.chart_id), SPOTIFY_CHART_SOURCES.map(item => item.id));
  assert.equal(h.messages.length, 21);
  assert.equal(materializedApiKey('https://example.test/api/spotify-charts?chart=regional-jp-daily&year=2026'), 'spotify-charts:regional-jp-daily:2026');
  assert.equal(materializedApiKey('https://example.test/api/spotify-charts?chart=bad&year=2026'), null);
  assert.equal(materializedApiKey('https://example.test/api/spotify-charts?chart=viral-jp-daily&year=2026'), null);
  assert.equal(spotifyChartModelKey('viral-jp-weekly', '2026'), null);
  assert.equal(PUBLIC_R2_MODEL_KEYS.has('spotify-charts:viral-jp-daily:2026'), false);
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

test('queued jobs for retired Viral series are acknowledged without network, R2 or new Queue work', async () => {
  const h = harness(() => { throw new Error('No Spotify network allowed for retired series'); });
  h.r2.get = () => { throw new Error('No R2 read allowed for retired series'); };
  h.r2.put = () => { throw new Error('No R2 write allowed for retired series'); };
  for (const chart_id of ['viral-jp-daily', 'viral-jp-weekly']) {
    for (const mode of ['latest', 'history', 'archive', 'publish']) {
      const body = { ...work(mode), chart_id, cursor: '2026-05-14' };
      let acked = 0;
      let retried = 0;
      await processJapanChartMessage({
        body,
        ack: () => { acked++; },
        retry: () => { retried++; },
      }, h.env, h);
      assert.equal(acked, 1, `${chart_id} ${mode}: old queued work must be discarded`);
      assert.equal(retried, 0);
      assert.equal(h.messages.length, 0);
    }
  }
});

test('published chart index excludes retired Viral series even if old state remains stored', async () => {
  const h = harness(() => { throw new Error('Publication must not call Spotify'); });
  for (const chart_id of ['viral-jp-daily', 'viral-jp-weekly']) {
    h.r2.values.set(`spotify/charts/state/${chart_id}.json`, JSON.stringify({
      chart_id, status: 'unavailable', archive_probes_attempted: 136,
    }));
  }
  await runJapanChartWork(h.env, { ...work('publish'), requested_at: 1 }, h);
  const index = JSON.parse(h.r2.values.get(pagesR2ResponseKey('spotify-charts')));
  assert.deepEqual(index.charts.map(item => item.chart_id), SPOTIFY_CHART_SOURCES.map(item => item.id));
  assert.equal(index.charts.length, 21);
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

test('a newer Spotify source state is republished even when the index timestamp is newer than its request', async () => {
  const h = harness(() => { throw new Error('Publication must not call Spotify'); });
  const viral = SPOTIFY_EDITORIAL_PLAYLISTS.find(item => item.id === 'viral-hits-jp-daily');
  h.r2.values.set(pagesR2ResponseKey('spotify-charts'), JSON.stringify({
    ok: true,
    updated_at: 60000,
    charts: [{ chart_id: viral.id, updated_at: 40000, latest_status: 'error', status: 'error', observed_at: 30000 }],
  }));
  h.r2.values.set(`spotify/charts/state/${viral.id}.json`, JSON.stringify({
    chart_id: viral.id, updated_at: 70000, latest_status: 'ok', status: 'ok',
    latest_chart_date: '2026-10-25', observed_at: 70000, history_complete: true, years: ['2026'],
  }));
  h.now = () => 100000;

  await runJapanChartWork(h.env, {
    message_type: SPOTIFY_CHART_WORK, message_version: 1, chart_id: viral.id,
    mode: 'publish', requested_at: 50000,
  }, h);

  const index = JSON.parse(h.r2.values.get(pagesR2ResponseKey('spotify-charts')));
  const published = index.charts.find(item => item.chart_id === viral.id);
  assert.equal(index.updated_at, 100000);
  assert.equal(published.updated_at, 70000);
  assert.equal(published.latest_status, 'ok');
  assert.equal(published.status, 'ok');
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
  assert.equal(messages.filter(message => message.message_type === SPOTIFY_CHART_WORK).length, 21);
  const legacy = messages.find(message => message.message_type === 'spotify-scheduled-dispatch');
  assert.ok(legacy);
  let retries = 0;
  await processSpotifyScheduledDispatchEntry({ body: legacy, retry() { retries++; } }, env, {
    runSpotifyArtistChartScheduled: async () => { throw new Error('Legacy chart source unavailable'); },
  });
  assert.equal(retries, 1);
  assert.equal(messages.filter(message => message.message_type === SPOTIFY_CHART_WORK).length, 21);
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

test('manual Spotify Queue recovery uses the same twenty-one series registry as the scheduled collector', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../scripts/diagnose-spotify-artist-chart-actions.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ SPOTIFY_CHART_SOURCES \}/);
  assert.match(source, /for \(const spec of SPOTIFY_CHART_SOURCES\)/);
  assert.doesNotMatch(source, /\bSPOTIFY_JP_CHARTS\b/);
  assert.equal(SPOTIFY_CHART_SOURCES.length, 21);
});
