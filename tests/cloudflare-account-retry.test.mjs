import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCloudflareAccountId } from '../.github/scripts/resolve-cloudflare-account.mjs';

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test('Cloudflare account discovery retries network and transient HTTP failures', async () => {
  let attempts = 0;
  const delays = [];
  const retries = [];
  const accountId = await resolveCloudflareAccountId({
    token: 'token',
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('socket disconnected');
      if (attempts === 2) {
        return response({ success: false }, { ok: false, status: 522 });
      }
      return response({ success: true, result: [{ id: 'account-1' }] });
    },
    sleepImpl: async (delayMs) => { delays.push(delayMs); },
    onRetry: (retry) => { retries.push(retry); },
  });

  assert.equal(accountId, 'account-1');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.deepEqual(retries.map(({ status }) => status), [null, 522]);
  assert.match(retries[0].reason, /socket disconnected/);
  assert.match(retries[1].reason, /522/);
});

test('Cloudflare account discovery retries invalid JSON only for transient statuses', async () => {
  let attempts = 0;
  const delays = [];
  const accountId = await resolveCloudflareAccountId({
    token: 'token',
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 503,
          text: async () => '<html>temporary outage</html>',
        };
      }
      return response({ success: true, result: [{ id: 'account-1' }] });
    },
    sleepImpl: async (delayMs) => { delays.push(delayMs); },
    onRetry: () => {},
  });

  assert.equal(accountId, 'account-1');
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [1000]);
});

test('Cloudflare account discovery fails immediately for authentication errors', async () => {
  let attempts = 0;
  const delays = [];
  const retries = [];
  await assert.rejects(
    resolveCloudflareAccountId({
      token: 'token',
      fetchImpl: async () => {
        attempts += 1;
        return response(
          { success: false, errors: [{ message: 'forbidden' }] },
          { ok: false, status: 403 },
        );
      },
      sleepImpl: async (delayMs) => { delays.push(delayMs); },
      onRetry: (retry) => { retries.push(retry); },
    }),
    /forbidden/,
  );

  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
  assert.deepEqual(retries, []);
});

test('Cloudflare account discovery stops after four transient attempts', async () => {
  let attempts = 0;
  const delays = [];
  await assert.rejects(
    resolveCloudflareAccountId({
      token: 'token',
      fetchImpl: async () => {
        attempts += 1;
        return response({ success: false }, { ok: false, status: 521 });
      },
      sleepImpl: async (delayMs) => { delays.push(delayMs); },
      onRetry: () => {},
    }),
    /521/,
  );

  assert.equal(attempts, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});
