import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueChangedHistoryModels, refreshHistoryReadModel, consumeHistoryRefresh } from '../src/history-read-model-refresh.js';
import { HISTORY_READ_MODEL_KEYS, loadHistorySourceRevisions } from '../src/history-read-model-source.js';
import { renderHistoryReadModel } from '../src/history-read-model-renderer.js';
import { pagesActionsR2ResponseKey, loadMaterializedR2Response } from '../src/pages-response-r2.js';

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
      const object = { ...options, etag: String(++etag), value };
      objects.set(key, object); writes.push(key);
      return object;
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
const message = key => ({ version: 1, type: 'pages-history-refresh', key });

test('publication covers all history keys and unchanged ticks do no writes or queue work', async () => {
  const f = fixture();
  for (const key of HISTORY_READ_MODEL_KEYS) await refreshHistoryReadModel(f.env, message(key), 100, f.deps);
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
  const oldMessage = { ...message('history:daily'), source_revision: 'old' };
  await refreshHistoryReadModel(f.env, oldMessage, 100, f.deps);
  assert.equal((await refreshHistoryReadModel(f.env, oldMessage, 200, f.deps)).status, 'unchanged');
  assert.equal(rendered, 1);
  const response = await loadMaterializedR2Response(f.env.PAGES_RESPONSE_R2, 'history:daily', 200);
  assert.equal(response.headers.get('x-api-source'), 'actions-r2-raw');
  assert.equal((await response.json()).rows[0].revision, 'new');
});

test('a changing source is retried without publishing a stale generation', async () => {
  const f = fixture();
  f.deps.render = async () => { f.revisions['history:daily'] = 'changed'; return { ok: true }; };
  await assert.rejects(refreshHistoryReadModel(f.env, message('history:daily'), 100, f.deps), /source changed/);
  assert.deepEqual(f.writes, []);
});

test('failed raw publication repairs directly from the canonical envelope', async () => {
  const f = fixture();
  const put = f.env.PAGES_RESPONSE_R2.put;
  let fail = true;
  f.env.PAGES_RESPONSE_R2.put = async (...args) => {
    if (args[0].includes('actions-raw-meta') && fail) throw new Error('metadata unavailable');
    return put(...args);
  };
  await assert.rejects(refreshHistoryReadModel(f.env, message('history:daily'), 100, f.deps), /metadata unavailable/);
  assert.equal((await enqueueChangedHistoryModels(f.env, 200, f.deps)).keys.includes('history:daily'), true);
  fail = false;
  f.deps.render = () => { throw new Error('must not reread history after committed generation'); };
  const result = await refreshHistoryReadModel(f.env, message('history:daily'), 200, f.deps);
  assert.equal(result.status, 'raw-repaired');
  assert.equal((await refreshHistoryReadModel(f.env, message('history:daily'), 300, f.deps)).status, 'unchanged');
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

test('source checks use four indexed revisions and one current week row', async () => {
  const queries = [];
  const env = { OTHER_DB: { prepare(sql) {
    queries.push(sql);
    return { bind(...values) { this.values = values; return this; },
      async all() { assert.deepEqual(this.values, HISTORY_READ_MODEL_KEYS); return { results: [{ model_key: 'history:broadcasts', revision: 2, updated_at: 10 }] }; },
      async first() { return { updated_at: 20 }; },
    };
  } } };
  const revisions = await loadHistorySourceRevisions(env, Date.parse('2026-10-05T00:00:00Z'));
  assert.equal(queries.length, 2);
  assert.ok(queries.every(sql => !/COUNT\(|SUM\(|ORDER BY/.test(sql)));
  assert.match(revisions['history:weekly'], /2026-10-05:20:tracks:0$/);
  assert.match(revisions['host-history:summary'], /:2:10$/);
});

test('daily and weekly renderers do not persist derived track counts to D1', async () => {
  const env = { OTHER_DB: { prepare() { return {
    bind() { return this; }, async all() { return { results: [] }; },
    run() { throw new Error('generation should be read-only'); },
  }; } } };
  for (const key of ['history:daily', 'history:weekly']) {
    const payload = await renderHistoryReadModel(key, env, Date.parse('2026-10-05T00:00:00Z'));
    assert.equal(payload.ok, true);
    assert.equal(payload.to, '2026-10-05');
  }
});

test('UTC day boundaries and renderer changes invalidate the relevant history models', async () => {
  const env = { OTHER_DB: { prepare() { return {
    bind() { return this; }, async all() { return { results: [] }; }, async first() { return null; },
  }; } } };
  const before = await loadHistorySourceRevisions(env, Date.parse('2026-10-05T23:59:00Z'));
  const after = await loadHistorySourceRevisions(env, Date.parse('2026-10-06T00:00:00Z'));
  assert.notEqual(before['history:daily'], after['history:daily']);
  assert.equal(before['host-history:summary'], after['host-history:summary']);
  const changed = await loadHistorySourceRevisions({ ...env, HISTORY_READ_MODEL_RENDERER_REVISION: 'new-renderer' }, Date.parse('2026-10-06T00:00:00Z'));
  for (const key of HISTORY_READ_MODEL_KEYS) assert.notEqual(after[key], changed[key]);
});

test('publication stores the renderer identity used by Actions recovery', async () => {
  const f = fixture();
  f.env.HISTORY_READ_MODEL_RENDERER_REVISION = 'deployed-renderer';
  await refreshHistoryReadModel(f.env, message('history:daily'), 100, f.deps);
  const stored = f.objects.get(pagesActionsR2ResponseKey('history:daily'));
  assert.equal(JSON.parse(stored.value).renderer_revision, 'deployed-renderer');
});

test('R2 track-count corrections invalidate daily and weekly without D1 writes', async () => {
  const env = { OTHER_DB: { prepare() { return {
    bind() { return this; }, async all() { return { results: [] }; }, async first() { return null; },
  }; } } };
  let updated = 1;
  env.PAGES_RESPONSE_R2 = { get: async () => ({ json: async () => ({ updated_at: updated }) }) };
  const before = await loadHistorySourceRevisions(env, 1791205200000);
  updated = 2;
  const after = await loadHistorySourceRevisions(env, 1791205200000);
  assert.notEqual(before['history:daily'], after['history:daily']);
  assert.notEqual(before['history:weekly'], after['history:weekly']);
  assert.equal(before['history:broadcasts'], after['history:broadcasts']);
});

test('Actions recovery skips both generation and upload for an unchanged Worker model', async () => {
  const { materializeRevisionGatedVariant } = await import('../scripts/run-pages-read-model-revision-actions.mjs');
  const result = await materializeRevisionGatedVariant({ key: 'history:daily' }, {}, 100, {
    rendererRevision: 'renderer', loadSourceRevision: async () => 'revision',
    loadExistingEnvelope: async () => ({ version: 1, body: '{"ok":true}', source_revision: 'revision', renderer_revision: 'renderer' }),
    responseHandler: () => { throw new Error('unchanged model must not render'); },
    uploadEnvelope: () => { throw new Error('unchanged model must not upload'); },
  });
  assert.equal(result.skip_reason, 'unchanged-source');
  assert.equal(result.object_key, null);
});
