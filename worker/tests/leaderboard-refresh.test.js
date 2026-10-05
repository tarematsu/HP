import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshStationheadLeaderboard, consumeLeaderboardRefresh } from '../src/leaderboard-refresh.js';
const sourceKey = 'diagnostics/stationhead-leaderboard/history/' + 'a'.repeat(32) + '.json';
const message = { version: 1, type: 'stationhead-leaderboard-refresh', history_key: sourceKey, digest: 'current' };
function fixture({ published = null, importStatus = 'imported', publishFailure = false } = {}) {
  const calls = [];
  const artifact = { version: 1, digest: 'current', received_at: 100, records: [] };
  const env = {
    PAGES_RESPONSE_R2: {
      get: async key => key === sourceKey ? { json: async () => artifact } : published ? { json: async () => published } : null,
      put: async (_key, value) => { calls.push(['publish', JSON.parse(value)]); if (publishFailure) throw new Error('R2 unavailable'); },
    },
    OTHER_DB: { prepare: () => ({ first: async () => ({ payload_json: '{}' }) }) },
  };
  const dependencies = {
    importArtifact: async () => { calls.push(['import']); return { status: importStatus }; },
    materialize: async (_db, _now, options) => { calls.push(['materialize', options]); },
    loadModel: async () => { calls.push(['load']); return { rows: [{ rank: 1 }] }; },
  };
  return { env, dependencies, calls };
}
test('receipt pipeline imports, forces same-week model regeneration, then publishes', async () => {
  const f = fixture();
  const result = await refreshStationheadLeaderboard(f.env, message, 200, f.dependencies);
  assert.equal(result.status, 'published');
  assert.deepEqual(f.calls.map(c => c[0]), ['import', 'materialize', 'load', 'publish']);
  assert.deepEqual(f.calls[1][1], { force: true });
  assert.equal(f.calls[3][1].source_digest, 'current');
});
test('retry after committed import still regenerates and republishes', async () => {
  const f = fixture({ importStatus: 'unchanged' });
  await refreshStationheadLeaderboard(f.env, message, 200, f.dependencies);
  assert.equal(f.calls.at(-1)[0], 'publish');
});
test('published duplicates and out-of-order old notifications perform no D1 work', async () => {
  for (const published of [{ source_digest: 'current' }, { source_received_at: 101 }]) {
    const f = fixture({ published });
    assert.equal((await refreshStationheadLeaderboard(f.env, message, 200, f.dependencies)).status, 'unchanged');
    assert.deepEqual(f.calls, []);
  }
});
test('incomplete top 100 snapshots cannot replace a published model', async () => {
  const f = fixture({ importStatus: 'incomplete' });
  assert.equal((await refreshStationheadLeaderboard(f.env, message, 200, f.dependencies)).status, 'incomplete');
  assert.deepEqual(f.calls, [['import']]);
});
test('queue retries publication failures and acknowledges only successful processing', async () => {
  const events = [];
  const item = { body: message, ack: () => events.push('ack'), retry: () => events.push('retry') };
  await consumeLeaderboardRefresh({ messages: [item] }, {}, async () => { throw new Error('R2 unavailable'); });
  await consumeLeaderboardRefresh({ messages: [item] }, {}, async () => ({ status: 'published' }));
  assert.deepEqual(events, ['retry', 'ack']);
});
