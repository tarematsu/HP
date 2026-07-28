import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteCloudflareWorker,
  detachQueueConsumersForWorker,
} from '../.github/scripts/delete-cloudflare-worker.mjs';

const options = {
  accountId: 'account-123',
  apiToken: 'token-secret',
  scriptName: 'homepanel-video',
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('deletes a Worker through the Cloudflare scripts API with force enabled', async () => {
  let captured;
  const result = await deleteCloudflareWorker({
    ...options,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return json({ success: true, result: null });
    },
  });

  assert.deepEqual(result, { deleted: true, alreadyAbsent: false });
  assert.equal(
    captured.url,
    'https://api.cloudflare.com/client/v4/accounts/account-123/workers/scripts/homepanel-video?force=true',
  );
  assert.equal(captured.init.method, 'DELETE');
  assert.equal(captured.init.headers.Authorization, 'Bearer token-secret');
});

test('treats a missing Worker as an idempotent success', async () => {
  const notFound = await deleteCloudflareWorker({
    ...options,
    fetchImpl: async () => json({
      success: false,
      errors: [{ code: 10090, message: 'workers.api.error.script_not_found' }],
    }, 404),
  });

  assert.deepEqual(notFound, { deleted: false, alreadyAbsent: true });
});

test('detaches the matching Queue consumer and retries Worker deletion', async () => {
  const calls = [];
  let workerDeletes = 0;
  const result = await deleteCloudflareWorker({
    ...options,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (url.includes('/workers/scripts/homepanel-video')) {
        workerDeletes += 1;
        if (workerDeletes === 1) {
          return json({
            success: false,
            errors: [{
              code: 10058,
              message: "Cannot delete this Worker as it is a consumer for a Queue. Remove it from the Queue's consumers first, then retry.",
            }],
          }, 409);
        }
        return json({ success: true, result: null });
      }
      if (/\/queues\?/.test(url)) {
        return json({
          success: true,
          result: [{
            queue_id: 'queue-1',
            queue_name: 'videoscraper-manual-imports',
            consumers: [{
              consumer_id: 'consumer-1',
              type: 'worker',
              script_name: 'homepanel-video',
            }],
          }],
          result_info: { page: 1, per_page: 100, total_pages: 1 },
        });
      }
      if (url.endsWith('/queues/queue-1/consumers/consumer-1')) {
        return json({ success: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  assert.deepEqual(result, {
    deleted: true,
    alreadyAbsent: false,
    detachedConsumers: 1,
  });
  assert.equal(workerDeletes, 2);
  assert.deepEqual(calls.map(({ method }) => method), ['DELETE', 'GET', 'DELETE', 'DELETE']);
  assert.equal(calls[2].url, 'https://api.cloudflare.com/client/v4/accounts/account-123/queues/queue-1/consumers/consumer-1');
});

test('lists Queue consumers separately when the Queue list omits consumer details', async () => {
  const calls = [];
  const detached = await detachQueueConsumersForWorker({
    ...options,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (/\/queues\?/.test(url)) {
        return json({
          success: true,
          result: [{ queue_id: 'queue-2', queue_name: 'manual-imports' }],
          result_info: { total_pages: 1 },
        });
      }
      if (url.endsWith('/queues/queue-2/consumers')) {
        return json({
          success: true,
          result: [{
            consumer_id: 'consumer-2',
            type: 'worker',
            script_name: 'homepanel-video',
          }],
        });
      }
      if (url.endsWith('/queues/queue-2/consumers/consumer-2')) {
        return json({ success: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  assert.equal(detached.length, 1);
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET', 'DELETE']);
});

test('fails closed when a Queue conflict has no matching consumer', async () => {
  let workerDeletes = 0;
  await assert.rejects(
    deleteCloudflareWorker({
      ...options,
      fetchImpl: async (url) => {
        if (url.includes('/workers/scripts/homepanel-video')) {
          workerDeletes += 1;
          return json({
            success: false,
            errors: [{
              code: 10058,
              message: 'Cannot delete this Worker as it is a consumer for a Queue.',
            }],
          }, 409);
        }
        return json({ success: true, result: [], result_info: { total_pages: 1 } });
      },
    }),
    /no matching Queue consumer was found/,
  );
  assert.equal(workerDeletes, 1);
});

test('fails closed for unexpected Cloudflare errors without leaking the token', async () => {
  await assert.rejects(
    deleteCloudflareWorker({
      ...options,
      fetchImpl: async () => json({
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
      }, 403),
    }),
    (error) => {
      assert.match(error.message, /Cloudflare Worker deletion failed: Authentication error/);
      assert.doesNotMatch(error.message, /token-secret/);
      return true;
    },
  );
});
