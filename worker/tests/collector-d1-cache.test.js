import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectorCachedDb,
  resetCollectorD1CacheForTests,
} from '../src/collector-d1-cache.js';

function fakeDb() {
  const calls = [];
  const rows = new Map([
    ['queue', { structural_hash: 'a', likes_hash: 'b', observed_at: 1 }],
    ['materialization', { station_id: 1, requested_count: 22 }],
  ]);
  return {
    calls,
    prepare(sql) {
      const source = String(sql);
      let params = [];
      return {
        bind(...values) {
          params = values;
          return this;
        },
        async first() {
          calls.push({ kind: 'first', sql: source, params });
          if (source.includes('sh_queue_materialization_state')) return { ...rows.get('materialization') };
          return { ...rows.get('queue') };
        },
        async run() {
          calls.push({ kind: 'run', sql: source, params });
          if (source.includes('sh_queue_current')) {
            rows.set('queue', { structural_hash: 'c', likes_hash: 'd', observed_at: 2 });
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
    async batch(statements) {
      calls.push({ kind: 'batch', count: statements.length });
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
}

const QUEUE_CURRENT_SQL = `SELECT current.structural_hash,current.likes_hash,
  current.start_time,current.observed_at,
  COALESCE((SELECT MAX(snapshot.observed_at) FROM sh_queue_snapshots snapshot
  WHERE snapshot.station_id IS current.station_id),0) AS latest_reachability_at
  FROM sh_queue_current current WHERE current.station_id IS ?`;

const MATERIALIZATION_SQL = `SELECT station_id,queue_id,start_time,source_structural_hash,
  source_likes_hash,total_track_count,materialized_count,requested_count,last_position,
  observed_at,updated_at FROM sh_queue_materialization_state WHERE station_id=?`;

test('stable queue state reads are served from the Worker isolate cache', async () => {
  const db = fakeDb();
  const cached = collectorCachedDb(db, {
    COLLECTOR_D1_QUEUE_CURRENT_CACHE_MS: 3_600_000,
    COLLECTOR_D1_MATERIALIZATION_CACHE_MS: 3_600_000,
  });

  assert.deepEqual(await cached.prepare(QUEUE_CURRENT_SQL).bind(1).first(), {
    structural_hash: 'a', likes_hash: 'b', observed_at: 1,
  });
  assert.deepEqual(await cached.prepare(QUEUE_CURRENT_SQL).bind(1).first(), {
    structural_hash: 'a', likes_hash: 'b', observed_at: 1,
  });
  assert.deepEqual(await cached.prepare(MATERIALIZATION_SQL).bind(1).first(), {
    station_id: 1, requested_count: 22,
  });
  assert.deepEqual(await cached.prepare(MATERIALIZATION_SQL).bind(1).first(), {
    station_id: 1, requested_count: 22,
  });

  assert.equal(db.calls.filter(({ kind }) => kind === 'first').length, 2);
  resetCollectorD1CacheForTests(db);
});

test('queue writes invalidate the cached current row', async () => {
  const db = fakeDb();
  const cached = collectorCachedDb(db, { COLLECTOR_D1_QUEUE_CURRENT_CACHE_MS: 3_600_000 });

  await cached.prepare(QUEUE_CURRENT_SQL).bind(1).first();
  await cached.prepare('UPDATE sh_queue_current SET observed_at=? WHERE station_id=?').bind(2, 1).run();
  const current = await cached.prepare(QUEUE_CURRENT_SQL).bind(1).first();

  assert.equal(current.structural_hash, 'c');
  assert.equal(db.calls.filter(({ kind }) => kind === 'first').length, 2);
  resetCollectorD1CacheForTests(db);
});
