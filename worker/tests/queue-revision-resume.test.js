import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createPartialRevision } from '../src/minute-partial-revision.js';
import { createOptimizedRevision } from '../src/minute-facts-track-resolution.js';
import { queueStructuralHash, queueStructurePayload } from '../src/minute-facts-normalize.js';
import { resolveMissingQueueRevisionTracks } from '../src/minute-queue-revision-progress.js';

test('resume resolves only holes while preserving preceding duration and invalid schedules', async () => {
  const tracks = [100, 200, null, 400].map((duration_ms, position) => ({ position, duration_ms }));
  let selected;
  const resolved = await resolveMissingQueueRevisionTracks(tracks, [{ position: 0 }, { position: 2 }], async (missing) => {
    selected = missing.map((track) => track.position);
    return missing.map((track) => ({ ...track, trackId: track.position + 10 }));
  });
  assert.deepEqual(selected, [1, 3]);
  assert.deepEqual(resolved.map(({ playbackOffset, scheduleValid }) => [playbackOffset, scheduleValid]), [[100, true], [null, false]]);
  await resolveMissingQueueRevisionTracks(tracks, tracks, () => assert.fail('complete positions must not resolve again'));
});

for (const createRevision of [createOptimizedRevision, createPartialRevision]) {
  test(`${createRevision.name}: resume does not read or rewrite persisted track identities`, async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../../database/facts-migrations/001_initial_schema.sql', import.meta.url), 'utf8'));
    const calls = [];
    const db = {
      prepare(sql) {
        return { bind(...args) {
          const statement = sqlite.prepare(sql);
          return {
            async first() { calls.push({ sql, args }); return statement.get(...args) ?? null; },
            async all() { calls.push({ sql, args }); return { results: statement.all(...args) }; },
            async run() { calls.push({ sql, args }); return { meta: { changes: Number(statement.run(...args).changes) } }; },
          };
        } };
      },
      async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
    };
    const queue = { queue_id: 7, start_time: 1700000000000, tracks: [0, 1, 2].map((position) => ({ position, isrc: `JP-${position}`, duration_ms: 100 })) };
    const hash = await queueStructuralHash(queue, queueStructurePayload(queue));
    sqlite.prepare(`INSERT INTO sh_queue_revisions(id,channel_id,queue_id,queue_start_time,effective_at,received_at,structural_hash,item_count,status,source,source_priority) VALUES(1,318,7,?,1,1,?,3,'pending','live_collector',100)`).run(queue.start_time, hash);
    sqlite.exec(`INSERT INTO sh_tracks(id,canonical_key,isrc,first_seen_at,last_seen_at) VALUES(10,'isrc:JP-0','JP-0',1,1),(12,'isrc:JP-2','JP-2',1,1);
      INSERT INTO sh_queue_revision_items(revision_id,position,track_id,duration_ms,playback_offset_ms,schedule_valid) VALUES(1,0,10,100,0,1),(1,2,12,100,200,1);`);
    const input = { channelId: 318, stationId: null, sessionId: null, queue, observedAt: 1700000000100, receivedAt: 1700000000101 };
    await createRevision(db, null, input);
    assert.deepEqual(sqlite.prepare('SELECT position,playback_offset_ms FROM sh_queue_revision_items ORDER BY position').all().map((row) => [row.position,row.playback_offset_ms]), [[0,0],[1,100],[2,200]]);
    assert.equal(sqlite.prepare('SELECT last_seen_at FROM sh_tracks WHERE id=10').get().last_seen_at, 1);
    assert.equal(sqlite.prepare('SELECT last_seen_at FROM sh_tracks WHERE id=12').get().last_seen_at, 1);
    const identityReads = calls.filter(({ sql }) => /FROM sh_tracks|FROM sh_track_aliases/.test(sql));
    assert.ok(identityReads.length > 0);
    assert.ok(identityReads.every(({ args }) => !args.includes('JP-0') && !args.includes('JP-2') && !args.includes('isrc:JP-0') && !args.includes('isrc:JP-2')));
    calls.length = 0;
    await createRevision(db, null, input);
    assert.equal(calls.length, 1);
    sqlite.close();
  });

}
