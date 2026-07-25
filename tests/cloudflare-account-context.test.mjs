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

test('explicit Cloudflare account avoids discovery and does not require a token', async () => {
  let calls = 0;
  const accountId = await resolveCloudflareAccountId({
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
    resolveCloudflareAccountId({ token: 'token\ninjected' }),
    /single line/,
  );
  await assert.rejects(
    resolveCloudflareAccountId({ accountId: 'account\ninjected' }),
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

test('the composite action is the single production credential resolver', () => {
  const action = readSource('.github/actions/cloudflare-context/action.yml');
  const configResolver = readSource('.github/scripts/resolve-cloudflare-config.mjs');
  const deploymentGuard = readSource('.github/scripts/assert-actions-only-cloudflare.mjs');
  const cloudDeploy = readSource('.github/workflows/cloud-deploy.yml');
  const pruneUpdates = readSource('.github/workflows/prune-homepanel-updates.yml');
  const shObservability = readSource('.github/workflows/sh-observability.yml');
  const hpObservability = readSource('.github/workflows/hp-observability.yml');
  const nativeBuild = readSource('.github/workflows/native-windows-build.yml');

  assert.match(action, /node \.github\/scripts\/resolve-cloudflare-account\.mjs/);
  assert.doesNotMatch(action, /curl|jq|mapfile/);

  assert.match(configResolver, /stripJsonc/);
  assert.match(configResolver, /update_bucket/);
  assert.doesNotMatch(configResolver, /resolve-cloudflare-account|CLOUDFLARE_|account_id/);

  assert.match(deploymentGuard, /process\.env\.CLOUDFLARE_API_TOKEN/);
  assert.match(deploymentGuard, /process\.env\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(deploymentGuard, /CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required/);
  assert.doesNotMatch(
    deploymentGuard,
    /CLOUDFLARE_BUILDS_API_TOKEN|accounts\?(?:page|per_page)|could not be inferred uniquely/,
  );

  assert.match(cloudDeploy, /uses: \.\/\.github\/actions\/cloudflare-context/);
  assert.match(cloudDeploy, /api-token: \$\{\{ secrets\.CLOUDFLARE_BUILDS_API_TOKEN \}\}/);
  assert.match(cloudDeploy, /\.github\/actions\/cloudflare-context\/action\.yml/);
  assert.match(cloudDeploy, /\.github\/scripts\/resolve-cloudflare-account\.mjs/);
  assert.match(cloudDeploy, /assert-actions-only-cloudflare\.mjs/);
  assert.doesNotMatch(cloudDeploy, /Validate Cloudflare credentials/);
  assert.doesNotMatch(cloudDeploy, /resolve-cloudflare-config\.mjs/);
  assert.doesNotMatch(
    cloudDeploy,
    /^\s{6}CLOUDFLARE_(?:API_TOKEN|BUILDS_API_TOKEN):/m,
  );

  for (const workflow of [shObservability, hpObservability]) {
    assert.match(workflow, /uses: \.\/\.github\/actions\/cloudflare-context/);
    assert.match(workflow, /api-token: \$\{\{ secrets\.CLOUDFLARE_BUILDS_API_TOKEN \}\}/);
    assert.doesNotMatch(
      workflow,
      /^\s{6}CLOUDFLARE_(?:API_TOKEN|BUILDS_API_TOKEN):/m,
    );
  }

  assert.match(nativeBuild, /uses: \.\/\.github\/actions\/cloudflare-context/);
  assert.match(nativeBuild, /node \.github\/scripts\/resolve-cloudflare-config\.mjs/);
  assert.ok(
    nativeBuild.indexOf('uses: ./.github/actions/cloudflare-context')
      < nativeBuild.indexOf('node .github/scripts/resolve-cloudflare-config.mjs'),
  );
  assert.equal(
    nativeBuild.match(/secrets\.CLOUDFLARE_BUILDS_API_TOKEN/g)?.length,
    1,
  );
  assert.doesNotMatch(nativeBuild, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(
    nativeBuild,
    /^\s+CLOUDFLARE_(?:API_TOKEN|BUILDS_API_TOKEN|ACCOUNT_ID):/m,
  );
  for (const dependency of [
    '.github/actions/cloudflare-context/action.yml',
    '.github/scripts/resolve-cloudflare-account.mjs',
    '.github/scripts/resolve-cloudflare-config.mjs',
  ]) {
    assert.ok(nativeBuild.split(dependency).length - 1 >= 2, dependency);
  }

  assert.match(pruneUpdates, /uses: \.\/\.github\/actions\/cloudflare-context/);
  assert.match(pruneUpdates, /\/r2\/buckets\/\$\{UPDATE_BUCKET\}\/objects/);
  assert.match(pruneUpdates, /result_info\.is_truncated/);
  assert.match(pruneUpdates, /-X DELETE/);
  assert.doesNotMatch(
    pruneUpdates,
    /user\/tokens\/verify|accounts\?per_page=50|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|aws s3api|sha256sum/,
  );
});
