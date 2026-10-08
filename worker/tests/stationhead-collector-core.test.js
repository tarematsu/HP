import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compactStationheadSnapshot,
  prepareStationheadChannelPayload,
} from '../src/stationhead-collector-core.js';
import { stationheadSourceEnv } from '../src/runtime-env.js';

const channel = {
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
    owner: { id: 77, handle: 'OwnerHost' },
    streaming_party: { stream_goal: 1000, current_stream_count: 432 },
    queue: { id: 10, tracks: [] },
  },
};

test('generic Stationhead collector core normalizes source payloads before source persistence', () => {
  const prepared = prepareStationheadChannelPayload(channel, 'ohisama');
  assert.equal(prepared.snapshot.channel_id, 46);
  assert.equal(prepared.snapshot.station_id, 99);
  assert.equal(prepared.snapshot.host_handle, 'ownerhost');
  const compact = compactStationheadSnapshot(channel, 'ohisama');
  assert.deepEqual(compact, {
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
    host_handle: 'ownerhost',
  });
});

test('source environment aliases only the source-specific database binding', () => {
  const buddies = { BUDDIES_DB: { id: 'b' } };
  const ohisama = { OHISAMA_DB: { id: 'o' } };
  assert.equal(stationheadSourceEnv(buddies, 'buddies').DB.id, 'b');
  assert.equal(stationheadSourceEnv(ohisama, 'ohisama').DB.id, 'o');
});

test('compact Stationhead snapshot does not parse an unrelated playback queue', () => {
  let queueAccesses = 0;
  const snapshotOnly = {
    ...channel,
    current_station: {
      ...channel.current_station,
      get queue() {
        queueAccesses += 1;
        throw new Error('queue parsing is not needed for a compact snapshot');
      },
    },
  };
  assert.equal(compactStationheadSnapshot(snapshotOnly, 'ohisama').channel_id, 46);
  assert.equal(queueAccesses, 0);
  assert.throws(
    () => prepareStationheadChannelPayload(snapshotOnly, 'ohisama'),
    /queue parsing is not needed/,
  );
});
