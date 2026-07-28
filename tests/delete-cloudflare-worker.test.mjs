import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteCloudflareWorker } from '../.github/scripts/delete-cloudflare-worker.mjs';

const options = {
  accountId: 'account-123',
  apiToken: 'token-secret',
  scriptName: 'homepanel-video',
};

test('deletes a Worker through the Cloudflare scripts API with force enabled', async () => {
  let captured;
  const result = await deleteCloudflareWorker({
    ...options,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ success: true, result: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
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
    fetchImpl: async () => new Response(JSON.stringify({
      success: false,
      errors: [{ code: 10090, message: 'workers.api.error.script_not_found' }],
    }), { status: 404 }),
  });

  assert.deepEqual(notFound, { deleted: false, alreadyAbsent: true });
});

test('fails closed for unexpected Cloudflare errors without leaking the token', async () => {
  await assert.rejects(
    deleteCloudflareWorker({
      ...options,
      fetchImpl: async () => new Response(JSON.stringify({
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
      }), { status: 403 }),
    }),
    (error) => {
      assert.match(error.message, /Cloudflare Worker deletion failed: Authentication error/);
      assert.doesNotMatch(error.message, /token-secret/);
      return true;
    },
  );
});
