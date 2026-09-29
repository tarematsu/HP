import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  OHISAMA_COLLECTOR_CRON,
  fiveMinuteBucket,
  normalizeOhisamaSnapshot,
} from '../src/ohisama-collector-entry.js';

test('ohisama collector runs every five minutes', () => {
  assert.equal(OHISAMA_COLLECTOR_CRON, '*/5 * * * *');
  assert.equal(fiveMinuteBucket(1_790_000_299_999), 1_790_000_100_000);
  assert.equal(fiveMinuteBucket(1_790_000_400_000), 1_790_000_400_000);
});

test('ohisama normalization keeps only aggregate channel metrics', () => {
  const value = normalizeOhisamaSnapshot({
    id: 46,
    alias: 'ohisama',
    online_member_count: 120,
    total_member_count: 9876,
    current_station_id: 99,
    current_station: {
      id: 99,
      is_broadcasting: true,
      listener_count: 88,
      guest_count: 3,
      total_listens: 654321,
      streaming_party: { stream_goal: 1000, current_stream_count: 432 },
      queue: { tracks: [{ title: 'must not be persisted' }] },
      chat: [{ body: 'must not be persisted' }],
    },
  });
  assert.deepEqual(value, {
    channel_id: 46,
    station_id: 99,
    is_broadcasting: 1,
    listener_count: 88,
    online_member_count: 120,
    total_member_count: 9876,
    guest_count: 3,
    reported_total_listens: 654321,
    stream_goal: 1000,
    reported_current_stream_count: 432,
  });
  assert.equal('queue' in value, false);
  assert.equal('track' in value, false);
  assert.equal('chat' in value, false);
});

test('ohisama auth acquisition is fixed to ILYS while collection remains ohisama', () => {
  const source = readFileSync(new URL('../src/ohisama-collector-entry.js', import.meta.url), 'utf8');
  assert.match(source, /DEFAULT_AUTH_HANDLE = 'ilys'/);
  assert.match(source, /STATIONHEAD_AUTH_PAGE_URL/);
  assert.match(source, /station\/handle\/\$\{encodeURIComponent\(authHandle\)\}\/guest/);
  assert.match(source, /env\.CHANNEL_ALIAS \|\| 'ohisama'/);
});

test('ohisama Worker config uses one dedicated D1, one Pages R2 binding, and no queues', () => {
  const config = JSON.parse(readFileSync(
    new URL('../wrangler.ohisama-collector.jsonc', import.meta.url),
    'utf8',
  ));
  assert.equal(config.name, 'sh-ohisama-collector');
  assert.equal(config.main, 'src/ohisama-pages-entry.js');
  assert.deepEqual(config.triggers.crons, ['*/5 * * * *']);
  assert.deepEqual(config.d1_databases.map(({ binding, database_name }) => ({ binding, database_name })), [
    { binding: 'OHISAMA_DB', database_name: 'stationhead-ohisama' },
  ]);
  assert.deepEqual(config.r2_buckets, [
    { binding: 'PAGES_RESPONSE_R2', bucket_name: 'sh-pages-responses' },
  ]);
  assert.equal(config.queues, undefined);
  assert.equal(config.durable_objects, undefined);
});
