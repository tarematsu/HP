import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  exportCloudflareContext,
  resolveCloudflareAccountId,
} from '../.github/scripts/resolve-cloudflare-account.mjs';
import { readSource } from './helpers/source-contract.mjs';

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test('explicit Cloudflare account avoids discovery', async () => {
  let calls = 0;
  const accountId = await resolveCloudflareAccountId({
    token: 'token',
    accountId: 'account-explicit',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('unexpected lookup');
    },
  });
  assert.equal(accountId, 'account-explicit');
  assert.equal(calls, 0);
});

test('Cloudflare account discovery requires exactly one valid account', async () => {
  const accountId = await resolveCloudflareAccountId({
    token: 'token',
    fetchImpl: async () => response({
      success: true,
      result: [{ id: 'account-1' }],
    }),
  });
  assert.equal(accountId, 'account-1');

  await assert.rejects(
    resolveCloudflareAccountId({
      token: 'token',
      fetchImpl: async () => response({ success: true, result: [] }),
    }),
    /found 0/,
  );
  await assert.rejects(
    resolveCloudflareAccountId({
      token: 'token',
      fetchImpl: async () => response({
        success: true,
        result: [{ id: 'a' }, { id: 'b' }],
      }),
    }),
    /found 2/,
  );
  await assert.rejects(
    resolveCloudflareAccountId({
      token: 'token',
      fetchImpl: async () => response(
        { success: false, errors: [{ message: 'forbidden' }] },
        { ok: false, status: 403 },
      ),
    }),
    /forbidden/,
  );
});

test('Cloudflare context export rejects multiline values and writes canonical variables', async () => {
  await assert.rejects(
    resolveCloudflareAccountId({ token: 'token\ninjected', accountId: 'account' }),
    /single line/,
  );
  await assert.rejects(
    resolveCloudflareAccountId({ token: 'token', accountId: 'account\ninjected' }),
    /single line/,
  );

  const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudflare-context-'));
  const envFile = path.join(directory, 'github-env');
  try {
    const accountId = await exportCloudflareContext({
      token: 'token',
      accountId: 'account-1',
      envFile,
    });
    assert.equal(accountId, 'account-1');
    assert.equal(
      await readFile(envFile, 'utf8'),
      [
        'CLOUDFLARE_API_TOKEN=token',
        'CLOUDFLARE_BUILDS_API_TOKEN=token',
        'CLOUDFLARE_ACCOUNT_ID=account-1',
        '',
      ].join('\n'),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the composite action and deploy config share one resolver implementation', () => {
  const action = readSource('.github/actions/cloudflare-context/action.yml');
  const configResolver = readSource('.github/scripts/resolve-cloudflare-config.mjs');

  assert.match(action, /node \.github\/scripts\/resolve-cloudflare-account\.mjs/);
  assert.doesNotMatch(action, /curl|jq|mapfile/);
  assert.match(configResolver, /from "\.\/resolve-cloudflare-account\.mjs"/);
  assert.match(configResolver, /resolveCloudflareAccountId\(\{/);
  assert.doesNotMatch(configResolver, /async function cloudflareAccountId/);
});
