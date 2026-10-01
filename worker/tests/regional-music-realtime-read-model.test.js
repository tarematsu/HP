import assert from 'node:assert/strict';
import test from 'node:test';

import { runRegionalMusicQueue } from '../src/regional-music-entry.js';

function message(body) {
  let acked = false;
  return {
    body,
    ack() { acked = true; },
    get acked() { return acked; },
  };
}

test('provider errors do not stop later services and every completed attempt refreshes the read model', async () => {
  const first = message({ message_type: 'regional-music-collect', service: 'genie', scheduled_at: 1000 });
  const second = message({ message_type: 'regional-music-collect', service: 'bugs', scheduled_at: 2000 });
  const collected = [];
  const published = [];
  let progressCalls = 0;

  await runRegionalMusicQueue(
    { messages: [first, second] },
    {},
    async () => {},
    {
      attemptState: async () => null,
      ensureAttemptRecorded: async (_env, service, scheduledAt, result) => {
        collected.push({ service, scheduledAt, status: result.status });
      },
      collectService: async (service) => service === 'genie'
        ? { service, status: 'error', error: 'upstream failed' }
        : { service, status: 'ok', artists: 3 },
      completionForRun: async () => ({
        snapshot_date: '2026-10-02',
        completed_services: ++progressCalls,
        total_services: 19,
        complete: false,
        statuses: {},
      }),
      publishReadModel: async () => {
        published.push(Date.now());
        return { ok: true };
      },
    },
  );

  assert.equal(first.acked, true);
  assert.equal(second.acked, true);
  assert.deepEqual(collected.map((item) => item.status), ['error', 'ok']);
  assert.equal(published.length, 2);
});

test('the nineteenth terminal attempt immediately finalizes the read model', async () => {
  const last = message({ message_type: 'regional-music-collect', service: 'langit_musik', scheduled_at: 3000 });
  let publishCount = 0;

  await runRegionalMusicQueue(
    { messages: [last] },
    {},
    async () => {},
    {
      attemptState: async () => null,
      ensureAttemptRecorded: async () => null,
      collectService: async () => ({ service: 'langit_musik', status: 'pending' }),
      completionForRun: async () => ({
        snapshot_date: '2026-10-02',
        completed_services: 19,
        total_services: 19,
        complete: true,
        statuses: { langit_musik: 'pending' },
      }),
      publishReadModel: async () => {
        publishCount += 1;
        return { ok: true };
      },
    },
  );

  assert.equal(last.acked, true);
  assert.equal(publishCount, 1);
});

test('a final read-model write failure leaves the last queue message unacked for retry', async () => {
  const last = message({ message_type: 'regional-music-collect', service: 'langit_musik', scheduled_at: 4000 });

  await assert.rejects(() => runRegionalMusicQueue(
    { messages: [last] },
    {},
    async () => {},
    {
      attemptState: async () => null,
      ensureAttemptRecorded: async () => null,
      collectService: async () => ({ service: 'langit_musik', status: 'error', error: 'blocked' }),
      completionForRun: async () => ({
        snapshot_date: '2026-10-02',
        completed_services: 19,
        total_services: 19,
        complete: true,
        statuses: { langit_musik: 'error' },
      }),
      publishReadModel: async () => { throw new Error('R2 unavailable'); },
    },
  ), /R2 unavailable/);

  assert.equal(last.acked, false);
});


test('Cloudflare queue context is never forwarded as the collector fetch function', async () => {
  const item = message({ message_type: 'regional-music-collect', service: 'genie', scheduled_at: 1000 });
  let actualFetch;
  await runRegionalMusicQueue({ messages: [item] }, {}, { waitUntil() {} }, {
    attemptState: async () => null,
    ensureAttemptRecorded: async () => {},
    collectService: async (_service, _env, _at, fetchImpl) => {
      actualFetch = fetchImpl;
      return { service: 'genie', status: 'ok' };
    },
    completionForRun: async () => ({ complete: false }),
    publishReadModel: async () => ({ ok: true }),
  });
  assert.equal(actualFetch, globalThis.fetch);
  assert.equal(item.acked, true);
});
