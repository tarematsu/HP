import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshStationheadLeaderboard, consumeLeaderboardRefresh } from '../src/leaderboard-refresh.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

const sourceKey = 'diagnostics/stationhead-leaderboard/history/' + 'a'.repeat(32) + '.json';
const modelKey = pagesR2ResponseKey('leaderboard');
const message = { version: 1, type: 'stationhead-leaderboard-refresh', history_key: sourceKey, digest: 'current' };

function fixture({ published = null, importStatus = 'imported', publishFailure = false } = {}) {
  const calls = [];
  const artifact = { version: 1, digest: 'current', received_at: 100, records: [] };
  const env = {
    PAGES_RESPONSE_R2: {
      get: async key => key === sourceKey ? { json: async () => artifact } : null,
      head: async key => key === modelKey && published ? { customMetadata: {
        source_digest: published.source_digest == null ? undefined : String(published.source_digest),
        source_received_at: published.source_received_at == null ? undefined : String(published.source_received_at),
      } } : null,
      put: async (key, value, options) => {
        calls.push(['publish', key, JSON.parse(value), options]);
        if (publishFailure) throw new Error('R2 unavailable');
      },
    },
    OTHER_DB: { prepare: () => { throw new Error('must not reread generated model'); } },
  };
  const dependencies = {
    importArtifact: async () => { calls.push(['import']); return { status: importStatus }; },
    materialize: async (_db, _now, options) => { calls.push(['materialize', options]); return { model: { rows: [{ rank: 1 }] } }; },
  };
  return { env, dependencies, calls };
}

test('receipt pipeline imports, forces same-week regeneration, then publishes direct R2 model', async () => {
  const f = fixture();
  const result = await refreshStationheadLeaderboard(f.env, message, 200, f.dependencies);
  assert.equal(result.status, 'published');
  assert.deepEqual(f.calls.map(c => c[0]), ['import', 'materialize', 'publish']);
  assert.deepEqual(f.calls[1][1], { force: true, initialize: false, includeModel: true });
  assert.equal(f.calls[2][1], modelKey);
  assert.deepEqual(f.calls[2][2].rows, [{ rank: 1 }]);
  assert.equal(f.calls[2][3].customMetadata.source_digest, 'current');
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
