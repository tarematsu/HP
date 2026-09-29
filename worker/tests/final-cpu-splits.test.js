import assert from 'node:assert/strict';
import test from 'node:test';

import { processIngestFinalizeTask } from '../src/ingest-finalize-entry.js';
import { processIngestFactTask } from '../src/ingest-prepared-channel.js';
import { minuteFactQueueMessage } from '../src/minute-facts-queue.js';
import { processTrackMetadataTask } from '../src/track-metadata-entry.js';

test('read-model hydration, remaining preservation and writes run as separate metadata stages', async () => {
  const enqueued = [];
  const readModel = {
    channel: { channel_id: 10, observed_at: 20 },
    queue: {
      value: {
        tracks: [{
          spotify_id: 'spotify-album-gap',
          title: 'Song',
          artist: 'Artist',
          album_name: null,
          thumbnail_url: 'cover',
        }],
      },
    },
  };
  const dependencies = {
    hydrateReadModelMetadata: async (_env, value) => ({ ...value, hydrated: true }),
    preserveReadModelForWrite: async (_env, value) => ({ ...value, preserved: true }),
    enqueueReadModelStage: async (task, value, body) => enqueued.push({ task, value, body }),
  };
  const hydration = await processTrackMetadataTask({}, {
    message_type: 'stationhead-track-metadata',
    message_version: 1,
    task: 'read-model-hydration',
    job_id: 'read-model:10:20',
    read_model: readModel,
  }, dependencies);
  assert.equal(hydration.next_task, 'read-model-preserve');
  assert.equal(enqueued[0].value.hydrated, true);

  const preservation = await processTrackMetadataTask({}, {
    message_type: 'stationhead-track-metadata',
    message_version: 1,
    task: enqueued[0].task,
    job_id: 'read-model:10:20',
    read_model: enqueued[0].value,
  }, dependencies);
  assert.equal(preservation.next_task, 'read-model-write');
  assert.equal(enqueued[1].value.preserved, true);

  let written = null;
  const write = await processTrackMetadataTask({}, {
    message_type: 'stationhead-track-metadata',
    message_version: 1,
    task: enqueued[1].task,
    job_id: 'read-model:10:20',
    read_model: enqueued[1].value,
  }, {
    writePreparedReadModel: async (_env, value) => { written = value; },
  });

  assert.equal(write.pending, false);
  assert.equal(written.hydrated, true);
  assert.equal(written.preserved, true);
});

test('minute fact handoff bypasses the retired comments queue', async () => {
  const minuteFacts = [];
  const finalized = [];
  const observedAt = 1_784_000_000_000;
  const collectorState = {
    authToken: 'token',
    deviceUid: 'device',
    lastRunAt: observedAt,
    lastSuccessAt: observedAt + 1,
  };
  const result = await processIngestFactTask({
    DB: {},
    MINUTE_FACT_QUEUE: {
      async send(body) { minuteFacts.push(body); },
    },
  }, {
    message_type: 'stationhead-ingest-fact',
    message_version: 1,
    fact: {
      observedAt,
      snapshot: { channel_id: 10, station_id: 20 },
      queue: { station_id: 20, tracks: [] },
      auth: { authToken: 'token', deviceUid: 'device' },
      collectorState,
      options: {
        readModelPresentationOnly: true,
        readModel: {
          channel: { channel_id: 10, observed_at: observedAt, presentation: {} },
          queue: { station_id: 20 },
          collector: { collector_id: 'cloudflare-worker', updated_at: observedAt },
        },
      },
    },
  }, {
    async handoffMinuteFactJob(activeEnv, input, options) {
      const message = minuteFactQueueMessage(input, options);
      await activeEnv.MINUTE_FACT_QUEUE.send(message, { contentType: 'json' });
      return { enqueued: true, outbox_pending: false, minute_at: message.minute_at };
    },
    async sendFinalize(body) { finalized.push(body); },
  });

  assert.equal(minuteFacts.length, 1);
  assert.equal(minuteFacts[0].message_type, 'minute-fact-job');
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].message_type, 'stationhead-ingest-finalize');
  assert.equal(finalized[0].collector_state, collectorState);
  assert.equal(finalized[0].read_model.message_type, 'stationhead-read-model');
  assert.equal(result.event, 'ingest_fact_completed');
});

test('ingest finalization preserves collector state before read-model handoff', async () => {
  const calls = [];
  const state = {
    authToken: 'token',
    deviceUid: 'device',
    lastRunAt: 20,
    lastSuccessAt: 21,
  };
  const readModel = { message_type: 'stationhead-read-model', job_id: 'read-model:10:20' };
  const result = await processIngestFinalizeTask({ DB: {} }, {
    message_type: 'stationhead-ingest-finalize',
    message_version: 1,
    observed_at: 20,
    channel_id: 10,
    collector_state: state,
    read_model: readModel,
  }, {
    saveCollectorState: async (_env, value) => {
      calls.push('state');
      assert.equal(value, state);
      return { accepted: true };
    },
    sendReadModel: async (value) => {
      calls.push('read-model');
      assert.equal(value, readModel);
    },
  });

  assert.deepEqual(calls, ['state', 'read-model']);
  assert.equal(result.state_accepted, true);
});

test('ingest finalization skips D1 between twenty-minute collector checkpoints', async () => {
  let readModels = 0;
  const result = await processIngestFinalizeTask({
    DB: new Proxy({}, { get() { assert.fail('checkpoint skip must not access D1'); } }),
  }, {
    message_type: 'stationhead-ingest-finalize',
    message_version: 1,
    observed_at: 20,
    channel_id: 10,
    collector_state: {
      authToken: 'token',
      deviceUid: 'device',
      checkpointDue: false,
    },
    read_model: { message_type: 'stationhead-read-model', job_id: 'read-model:10:20' },
  }, {
    sendReadModel: async () => { readModels += 1; },
  });
  assert.equal(readModels, 1);
  assert.equal(result.state_accepted, true);
  assert.equal(result.state_persisted, false);
});