import assert from 'node:assert/strict';
import test from 'node:test';

import { processTrackMetadataTask } from '../src/track-metadata-entry.js';

function hydrationBody(readModel, hydrationAttempt = null) {
  return {
    message_type: 'stationhead-track-metadata',
    message_version: 1,
    task: 'read-model-hydration',
    job_id: 'read-model:10:20',
    read_model: readModel,
    ...(hydrationAttempt == null ? {} : { hydration_attempt: hydrationAttempt }),
  };
}

function preservationBody(readModel, hydrationAttempt = null) {
  return {
    message_type: 'stationhead-track-metadata',
    message_version: 1,
    task: 'read-model-preserve',
    job_id: 'read-model:10:20',
    read_model: readModel,
    ...(hydrationAttempt == null ? {} : { hydration_attempt: hydrationAttempt }),
  };
}

test('successful hydration skips the redundant preservation invocation', async () => {
  const hydrated = {
    queue: {
      value: {
        tracks: [{
          spotify_id: 'spotify-complete',
          title: 'Song',
          artist: 'Artist',
          album_name: 'Album',
          thumbnail_url: 'cover',
        }],
      },
    },
  };
  const enqueued = [];
  const result = await processTrackMetadataTask({}, hydrationBody({ queue: { value: { tracks: [] } } }), {
    hydrateReadModelMetadata: async () => hydrated,
    enqueueReadModelStage: async (task, value) => enqueued.push({ task, value }),
  });

  assert.equal(result.pending, true);
  assert.equal(result.next_task, 'read-model-write');
  assert.deepEqual(enqueued, [{ task: 'read-model-write', value: hydrated }]);
});

test('unresolved identified gaps retain the preservation invocation', async () => {
  const hydrated = {
    queue: {
      value: {
        tracks: [{
          spotify_id: 'spotify-gap',
          title: 'Song',
          artist: 'Artist',
          album_name: null,
          thumbnail_url: 'cover',
        }],
      },
    },
  };
  const enqueued = [];
  const result = await processTrackMetadataTask({}, hydrationBody(hydrated), {
    hydrateReadModelMetadata: async () => hydrated,
    enqueueReadModelStage: async (task, value) => enqueued.push({ task, value }),
  });

  assert.equal(result.next_task, 'read-model-preserve');
  assert.deepEqual(enqueued, [{ task: 'read-model-preserve', value: hydrated }]);
});

test('preservation retries hydration while asynchronous enrichment can still arrive', async () => {
  const unresolved = {
    queue: {
      value: {
        tracks: [{
          spotify_id: 'spotify-gap',
          title: null,
          artist: null,
          album_name: null,
          thumbnail_url: null,
        }],
      },
    },
  };
  const enqueued = [];
  const result = await processTrackMetadataTask({}, preservationBody(unresolved), {
    preserveReadModelForWrite: async () => unresolved,
    enqueueReadModelStage: async (task, value, _body, options) => {
      enqueued.push({ task, value, options });
    },
  });

  assert.equal(result.next_task, 'read-model-hydration');
  assert.equal(result.hydration_attempt, 1);
  assert.equal(result.retry_after_seconds, 2);
  assert.deepEqual(enqueued, [{
    task: 'read-model-hydration',
    value: unresolved,
    options: { hydrationAttempt: 1, delaySeconds: 2 },
  }]);
});

test('read model hydration retry is bounded and eventually writes unresolved metadata', async () => {
  const unresolved = {
    queue: {
      value: {
        tracks: [{
          spotify_id: 'spotify-gap',
          title: null,
          artist: null,
          album_name: null,
          thumbnail_url: null,
        }],
      },
    },
  };
  const enqueued = [];
  const result = await processTrackMetadataTask({}, preservationBody(unresolved, 3), {
    preserveReadModelForWrite: async () => unresolved,
    enqueueReadModelStage: async (task, value) => enqueued.push({ task, value }),
  });

  assert.equal(result.next_task, 'read-model-write');
  assert.deepEqual(enqueued, [{ task: 'read-model-write', value: unresolved }]);
});

test('preservation writes immediately when previous metadata closes the gap', async () => {
  const unresolved = {
    queue: {
      value: {
        tracks: [{ spotify_id: 'spotify-gap', title: null, artist: null, thumbnail_url: null }],
      },
    },
  };
  const resolved = {
    queue: {
      value: {
        tracks: [{
          spotify_id: 'spotify-gap',
          title: 'Song',
          artist: 'Artist',
          thumbnail_url: 'cover',
        }],
      },
    },
  };
  const enqueued = [];
  const result = await processTrackMetadataTask({}, preservationBody(unresolved), {
    preserveReadModelForWrite: async () => resolved,
    enqueueReadModelStage: async (task, value) => enqueued.push({ task, value }),
  });

  assert.equal(result.next_task, 'read-model-write');
  assert.deepEqual(enqueued, [{ task: 'read-model-write', value: resolved }]);
});
