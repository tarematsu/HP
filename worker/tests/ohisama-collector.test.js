import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  OHISAMA_COLLECTOR_CRON,
  fiveMinuteBucket,
  normalizeOhisamaSnapshot,
  registerOhisamaFollowerTarget,
} from '../src/ohisama-collector-entry.js';

test('ohisama collector runs every five minutes', () => {
  assert.equal(OHISAMA_COLLECTOR_CRON, '*/5 * * * *');
  assert.equal(fiveMinuteBucket(1_790_000_299_999), 1_790_000_100_000);
  assert.equal(fiveMinuteBucket(1_790_000_400_000), 1_790_000_400_000);
});

test('ohisama normalization keeps aggregate metrics and the active host identity', () => {
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
      host: { account_id: 77, account: { id: 77, handle: 'OhisamaHost' } },
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
    host_account_id: 77,
    host_handle: 'ohisamahost',
  });
  assert.equal('queue' in value, false);
  assert.equal('track' in value, false);
  assert.equal('chat' in value, false);
});

test('ohisama normalization accepts alternate broadcaster account shapes', () => {
  const value = normalizeOhisamaSnapshot({
    id: 46,
    alias: 'ohisama',
    current_station_id: 101,
    current_station: {
      id: 101,
      is_broadcasting: null,
      broadcaster: { id: 88, handle: 'AlternateHost' },
    },
  });
  assert.equal(value.host_account_id, 88);
  assert.equal(value.host_handle, 'alternatehost');
});

test('ohisama normalization reads syndicated station owner and host broadcaster', () => {
  const value = normalizeOhisamaSnapshot({
    id: 322,
    alias: 'ohisama',
    current_station_id: 5290918,
    current_station: {
      id: 5290918,
      is_broadcasting: true,
      owner_id: 5298487,
      owner: { id: 5298487, handle: 'HinataPR0211' },
      broadcast: {
        broadcasters: [
          {
            account_id: 5298487,
            is_host: true,
            account: { id: 5298487, handle: 'HinataPR0211' },
          },
        ],
      },
    },
  });
  assert.equal(value.host_account_id, 5298487);
  assert.equal(value.host_handle, 'hinatapr0211');
});

test('ohisama active host is permanently added to the follower target registry', async () => {
  let bound = null;
  let runs = 0;
  const env = {
    OTHER_DB: {
      prepare(sql) {
        assert.match(sql, /INSERT INTO sh_stationhead_follower_targets/);
        assert.match(sql, /source_mask=.*source_mask \| excluded\.source_mask/s);
        return {
          bind(...values) {
            bound = values;
            return {
              async run() {
                runs += 1;
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };
  assert.equal(await registerOhisamaFollowerTarget(env, {
    is_broadcasting: 1,
    host_handle: 'ohisamahost',
  }, 123456), true);
  assert.deepEqual(bound, ['ohisamahost', 4, 123456]);
  assert.equal(runs, 1);

  assert.equal(await registerOhisamaFollowerTarget(env, {
  is_broadcasting: 0,
  host_handle: 'idlehost',
}, 123457), true);
  assert.deepEqual(bound, ['idlehost', 4, 123457]);
  assert.equal(runs, 2);

  assert.equal(await registerOhisamaFollowerTarget(env, {
    is_broadcasting: 1,
    host_handle: null,
  }, 123458), false);
  assert.equal(runs, 2);
});

test('ohisama auth acquisition is fixed to ILYS while collection remains ohisama', () => {
  const source = readFileSync(new URL('../src/ohisama-collector-entry.js', import.meta.url), 'utf8');
  assert.match(source, /DEFAULT_AUTH_HANDLE = 'ilys'/);
  assert.match(source, /STATIONHEAD_AUTH_PAGE_URL/);
  assert.match(source, /station\/handle\/\$\{encodeURIComponent\(authHandle\)\}\/guest/);
  assert.match(source, /env\.CHANNEL_ALIAS \|\| 'ohisama'/);
});

test('ohisama Worker config binds its own D1 while scheduling is delegated', () => {
  const config = JSON.parse(readFileSync(
    new URL('../wrangler.ohisama-collector.jsonc', import.meta.url),
    'utf8',
  ));
  assert.equal(config.name, 'sh-ohisama-collector');
  assert.equal(config.main, 'src/ohisama-service-entry.js');
  assert.equal(config.triggers, undefined);
  assert.deepEqual(config.d1_databases.map(({ binding, database_name }) => ({ binding, database_name })), [
    { binding: 'OHISAMA_DB', database_name: 'stationhead-ohisama' },
    { binding: 'OTHER_DB', database_name: 'stationhead-other' },
  ]);
  assert.deepEqual(config.r2_buckets, [
    { binding: 'PAGES_RESPONSE_R2', bucket_name: 'sh-pages-responses' },
  ]);
  assert.equal(config.queues, undefined);
  assert.equal(config.durable_objects, undefined);

  const serviceEntry = readFileSync(new URL('../src/ohisama-service-entry.js', import.meta.url), 'utf8');
  assert.match(serviceEntry, /handleInternalScheduled/);
  assert.match(serviceEntry, /OHISAMA_COLLECTOR_CRON/);
});
