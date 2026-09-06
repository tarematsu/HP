import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  queueItemsToWrite,
  queueInspectionDue,
  planLikeObservations,
} from '../site/functions/lib/ingest.js';
import {
  SAKURAZAKA_EVENT_SQL,
  cachedSakurazakaSeries,
  resetSakurazakaSeriesCache,
} from '../site/functions/api/sakurazaka46jp.js';
import { cachedSnapshotCount, resetSnapshotCountCache } from '../site/functions/api/health.js';
import { DECODE_STATION_MAIN_SQL } from '../worker/src/official-news-index.js';

test('unchanged queue items only write when their stored state changes', () => {
  const observedAt = 10_000_000;
  const track = { position: 0, queue_track_id: 11, stationhead_track_id: 22, spotify_id: 'spotify', deezer_id: 'deezer', isrc: 'isrc', duration_ms: 180000, preview_url: 'preview', bite_count: 5, raw: { stable: true } };
  const existing = [{ position: 0, observed_at: observedAt - 1000, queue_id: 7, queue_track_id: 11, stationhead_track_id: 22, spotify_id: 'spotify', deezer_id: 'deezer', isrc: 'isrc', duration_ms: 180000, preview_url: 'preview', bite_count: 5, raw_json: JSON.stringify(track.raw) }];
  assert.equal(queueItemsToWrite([track], existing, observedAt, 7).length, 0);
  assert.equal(queueItemsToWrite([{ ...track, bite_count: 6 }], existing, observedAt, 7).length, 1);
  assert.equal(queueItemsToWrite([track], existing, observedAt + 3_600_000, 7).length, 0);
});

test('unchanged like counts are not written again during queue checkpoints', () => {
  const observedAt = 10_000_000;
  const track = { position: 0, queue_track_id: 11, bite_count: 5, raw: { stable: true } };
  const latest = [{ track_key: '11', observed_at: observedAt - 3_600_000, like_count: 5 }];
  assert.equal(planLikeObservations([track], latest, observedAt).length, 0);
});

test('unchanged queue payload skips all item and like inspection between checkpoints', () => {
  const observedAt = 10_000_000;
  const payload = '{"queue_id":7,"tracks":[1]}';
  assert.equal(queueInspectionDue(null, payload, observedAt), true);
  assert.equal(queueInspectionDue({ raw_json: payload, item_observed_at: observedAt - 1000 }, payload, observedAt), false);
  assert.equal(queueInspectionDue({ raw_json: '{"changed":true}', item_observed_at: observedAt - 1000 }, payload, observedAt), true);
  assert.equal(queueInspectionDue({ raw_json: payload, item_observed_at: observedAt - 3_600_000 }, payload, observedAt), true);
});

test('Sakurazaka series selects event starts in one filtered scan', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_official_broadcast_summary(
    host_handle TEXT NOT NULL,event_name TEXT NOT NULL,started_at INTEGER,
    ended_at INTEGER,PRIMARY KEY(host_handle,event_name)
  )`);
  const insert = db.prepare('INSERT INTO sh_official_broadcast_summary VALUES(?,?,?,?)');
  insert.run('sakurazaka46jp', 'event-a', 1000, 61000);
  insert.run('sakurazaka46jp', 'event-b', 121000, 181000);
  const rows = db.prepare(SAKURAZAKA_EVENT_SQL).all(0, 200000);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event_name, 'event-a');
  assert.equal(rows[0].started_at, 1000);
  assert.equal(rows[0].ended_at, 61000);
});

test('Sakurazaka series cache coalesces concurrent heavy queries', async () => {
  resetSakurazakaSeriesCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { series: [{ event_name: 'event-a' }] };
  };
  const [first, second] = await Promise.all([
    cachedSakurazakaSeries('range-a', loader),
    cachedSakurazakaSeries('range-a', loader),
  ]);
  assert.equal(calls, 1);
  assert.strictEqual(first, second);
  assert.strictEqual(await cachedSakurazakaSeries('range-a', loader), first);
  assert.equal(calls, 1);
});

test('snapshot health count keeps D1 work request-scoped', async () => {
  resetSnapshotCountCache();
  let calls = 0;
  const db = { prepare() { return { async first() { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { count: 42 }; } }; } };
  const values = await Promise.all([cachedSnapshotCount(db), cachedSnapshotCount(db)]);
  assert.deepEqual(values, [42, 42]);
  assert.equal(calls, 2);
  assert.equal(await cachedSnapshotCount(db), 42);
  assert.equal(calls, 2);
});

test('Sakurazaka raw save stages do not parse or stringify upstream payloads', () => {
  const source = readFileSync(new URL('../worker/src/official-news-probe.js', import.meta.url), 'utf8');
  const main = source.slice(
    source.indexOf('export async function collectStationMain'),
    source.indexOf('export async function decodeStationMain'),
  );
  const chat = source.slice(
    source.indexOf('export async function collectStationChat'),
    source.indexOf('function probeStatement'),
  );
  assert.match(main, /response\.text|stationTextRequest/);
  assert.match(chat, /stationTextRequest/);
  assert.doesNotMatch(main, /JSON\.(?:parse|stringify)|response\.json|json_(?:valid|extract)/);
  assert.doesNotMatch(chat, /JSON\.(?:parse|stringify)|response\.json|json_(?:valid|extract)/);
  assert.match(DECODE_STATION_MAIN_SQL, /json_extract\(/);
});

test('Sakurazaka chat table stores only raw response text and minute identity', () => {
  const migration = readFileSync(new URL(
    '../database/other-migrations/016_sakurazaka46jp_raw_collection.sql',
    import.meta.url,
  ), 'utf8');
  const chat = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_chat'));
  assert.match(chat, /raw_json TEXT NOT NULL/);
  assert.doesNotMatch(chat, /comment_count|latest_comment_id|oldest_comment_id|text\s+TEXT/);
});
