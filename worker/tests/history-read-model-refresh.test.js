import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueChangedHistoryModels, refreshHistoryReadModel, consumeHistoryRefresh } from '../src/history-read-model-refresh.js';
import { HISTORY_READ_MODEL_KEYS, loadHistorySourceRevisions } from '../src/history-read-model-source.js';
import { renderHistoryReadModel } from '../src/history-read-model-renderer.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import { loadReadModelR2 } from '../src/read-model-r2.js';

function fixture() {
  const objects = new Map();
  const sends = [];
  const writes = [];
  let etag = 0;
  const bucket = {
    async head(key) { return objects.get(key) || null; },
    async get(key) {
      const stored = objects.get(key);
      return stored ? { ...stored, body: stored.value, json: async () => JSON.parse(stored.value), text: async () => stored.value } : null;
    },
    async put(key, value, options) {
      const object = { ...options, customMetadata: options?.customMetadata || {}, etag: String(++etag), value };
      objects.set(key, object); writes.push(key); return object;
    },
  };
  const revisions = Object.fromEntries(HISTORY_READ_MODEL_KEYS.map(key => [key, `source:${key}`]));
  const deps = { loadRevisions: async () => revisions, render: async key => ({ ok: true, key, rows: [] }) };
  return { objects, writes, sends, revisions, deps, env: {
    OTHER_DB: { prepare() { throw new Error('no history DB work in injected fixture'); } },
    PAGES_RESPONSE_R2: bucket,
    HISTORY_READ_MODEL_QUEUE: { async send(body) { sends.push(body); } },
  } };
}
const message = key => ({ version: 2, type: 'pages-history-refresh', key });

test('publication covers all history keys with one R2 object each and unchanged ticks do no work', async () => {
  const f = fixture();
  for (const key of HISTORY_READ_MODEL_KEYS) await refreshHistoryReadModel(f.env, message(key), 100, f.deps);
  assert.deepEqual(new Set(f.writes), new Set(HISTORY_READ_MODEL_KEYS.map(pagesR2ResponseKey)));
  f.writes.length = 0;
  const result = await enqueueChangedHistoryModels(f.env, 200, f.deps);
  assert.equal(result.queued, 0);
  assert.deepEqual(f.sends, []);
  assert.deepEqual(f.writes, []);
  f.revisions['history:weekly'] = 'corrected';
  assert.deepEqual((await enqueueChangedHistoryModels(f.env, 200, f.deps)).keys, ['history:weekly']);
});

test('duplicate and delayed queue messages render only the latest revision once', async () => {
  const f = fixture();
  let rendered = 0;
  f.deps.render = async () => { rendered++; return { ok: true, rows: [{ revision: f.revisions['history:daily'] }] }; };
  f.revisions['history:daily'] = 'new';
  const delayed = { ...message('history:daily'), source_revision: 'old' };
  await refreshHistoryReadModel(f.env, delayed, 100, f.deps);
  assert.equal((await refreshHistoryReadModel(f.env, delayed, 200, f.deps)).status, 'unchanged');
  assert.equal(rendered, 1);
  const response = await loadReadModelR2(f.env.PAGES_RESPONSE_R2, 'history:daily', 200);
  assert.equal(response.headers.get('x-api-source'), 'worker-r2');
  assert.equal((await response.json()).rows[0].revision, 'new');
});

test('a changing source is retried without publishing a stale generation', async () => {
  const f = fixture();
  f.deps.render = async () => { f.revisions['history:daily'] = 'changed'; return { ok: true }; };
  await assert.rejects(refreshHistoryReadModel(f.env, message('history:daily'), 100, f.deps), /source changed/);
  assert.deepEqual(f.writes, []);
});

test('queue acknowledges successful models independently and retries failed models', async () => {
  const events = [];
  const messages = ['history:daily', 'history:weekly'].map(key => ({ body: message(key), ack: () => events.push(`${key}:ack`), retry: () => events.push(`${key}:retry`) }));
  await consumeHistoryRefresh({ messages }, {}, async (_env, body) => {
    if (body.key === 'history:daily') throw new Error('D1 unavailable');
    return { key: body.key, status: 'published' };
  });
  assert.deepEqual(events, ['history:daily:retry', 'history:weekly:ack']);
});

test('source checks use one compact revision query and no R2 reads', async () => {
  const queries = [];
  const values = new Map([
    ['history:daily', [2, 10]], ['history:weekly', [3, 20]], ['history:broadcasts', [4, 30]],
    ['host-history:summary', [5, 40]], ['weekly-ranking', [6, 50]], ['track-history', [7, 60]],
  ]);
  const env = { OTHER_DB: { prepare(sql) {
    queries.push(sql);
    return { bind(...keys) { this.keys = keys; return this; }, async all() {
      return { results: this.keys.map((key) => ({ model_key: key, revision: values.get(key)?.[0], updated_at: values.get(key)?.[1] })) };
    } };
  } } };
  const revisions = await loadHistorySourceRevisions(env, Date.parse('2026-10-05T00:00:00Z'));
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0], /COUNT\(|SUM\(|MAX\(|ORDER BY/);
  assert.match(revisions['history:daily'], /history:daily:2:10:tracks:7:60:day:2026-10-05$/);
  assert.match(revisions['history:weekly'], /history:weekly:3:20:tracks:7:60:live:6:50:day:2026-10-05$/);
  assert.match(revisions['host-history:summary'], /host-history:summary:5:40:broadcasts:4:30$/);
});

test('daily boundary invalidates date-bounded history without any storage scan', async () => {
  const env = { OTHER_DB: { prepare() { return { bind(...keys) { this.keys = keys; return this; }, async all() {
    return { results: this.keys.map((key) => ({ model_key: key, revision: 1, updated_at: 1 })) };
  } }; } } };
  const before = await loadHistorySourceRevisions(env, Date.parse('2026-10-05T23:59:00Z'));
  const after = await loadHistorySourceRevisions(env, Date.parse('2026-10-06T00:00:00Z'));
  for (const key of ['history:daily', 'history:weekly', 'history:broadcasts']) assert.notEqual(before[key], after[key]);
  assert.equal(before['host-history:summary'], after['host-history:summary']);
});

test('daily and weekly renderers never write derived values to D1', async () => {
  const env = { OTHER_DB: { prepare(sql) {
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
    return { bind() { return this; }, async all() { return { results: [] }; } };
  } } };
  for (const key of ['history:daily', 'history:weekly']) {
    const payload = await renderHistoryReadModel(key, env, Date.parse('2026-10-05T00:00:00Z'));
    assert.equal(payload.ok, true);
  }
});

test('publication stores source and renderer identity as R2 metadata', async () => {
  const f = fixture();
  f.env.HISTORY_READ_MODEL_RENDERER_REVISION = 'deployed-renderer';
  await refreshHistoryReadModel(f.env, message('history:daily'), 100, f.deps);
  const stored = f.objects.get(pagesR2ResponseKey('history:daily'));
  assert.equal(stored.customMetadata.source_revision, 'source:history:daily');
  assert.equal(stored.customMetadata.renderer_revision, 'deployed-renderer');
});
