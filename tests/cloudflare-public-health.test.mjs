import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  resolveCloudflareWorkerPublicUrl,
  workerHealthUrl,
} from '../.github/scripts/cloudflare-worker-public-url.mjs';
import {
  captureFromEnvironment,
  capturePublicHealthEndpoint,
  cloudflarePublicHealthWorkers,
  resolveCloudflarePublicHealthEndpoints,
} from '../.github/scripts/capture-public-health-endpoints.mjs';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cloudflareLookup(url) {
  if (url.endsWith('/accounts/account-123/workers/subdomain')) {
    return json({ success: true, result: { subdomain: 'tarematsu' } });
  }
  if (url.endsWith('/accounts/account-123/workers/scripts/homepanel-cloud/subdomain')) {
    return json({ success: true, result: { enabled: true, previews_enabled: false } });
  }
  throw new Error(`Unexpected Cloudflare lookup: ${url}`);
}

test('resolves an enabled Worker workers.dev URL without exposing account-specific configuration', async () => {
  const calls = [];
  const baseUrl = await resolveCloudflareWorkerPublicUrl({
    accountId: 'account-123',
    apiToken: 'token-secret',
    scriptName: 'homepanel-cloud',
    fetchImpl: async (url, init) => {
      calls.push({ url, authorization: init.headers.Authorization });
      return cloudflareLookup(url);
    },
  });

  assert.equal(baseUrl, 'https://homepanel-cloud.tarematsu.workers.dev');
  assert.equal(workerHealthUrl(baseUrl, '/api/health'), 'https://homepanel-cloud.tarematsu.workers.dev/api/health');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ authorization }) => authorization === 'Bearer token-secret'));
});

test('default public health collection captures Pages and HomePanel Worker health', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hp-public-health-'));
  const output = join(directory, 'health.md');
  const requested = [];
  try {
    const results = await captureFromEnvironment({
      env: {
        CLOUDFLARE_ACCOUNT_ID: 'account-123',
        CLOUDFLARE_API_TOKEN: 'token-secret',
        PUBLIC_HEALTH_OUTPUT: output,
      },
      fetchImpl: async (url, init = {}) => {
        requested.push(url);
        if (url.startsWith('https://api.cloudflare.com/')) return cloudflareLookup(url, init);
        if (url === 'https://skrzk.pages.dev/api/health') {
          return json({ ok: true, service: 'stationhead-pages-health' });
        }
        if (url === 'https://homepanel-cloud.tarematsu.workers.dev/api/health') {
          return json({ ok: true, service: 'homepanel-video' });
        }
        throw new Error(`Unexpected health request: ${url}`);
      },
    });

    assert.equal(results.length, 2);
    assert.ok(results.every(({ ok }) => ok));
    assert.ok(requested.includes('https://skrzk.pages.dev/api/health'));
    assert.ok(requested.includes('https://homepanel-cloud.tarematsu.workers.dev/api/health'));
    const report = await readFile(output, 'utf8');
    assert.match(report, /Endpoints:\*\* 2/);
    assert.match(report, /Unified health \| success/);
    assert.match(report, /HomePanel Cloud health \| success/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('disabled workers.dev exposure is preserved as a failed diagnostic endpoint', async () => {
  assert.deepEqual(cloudflarePublicHealthWorkers(), [
    { name: 'HomePanel Cloud health', scriptName: 'homepanel-cloud', path: '/api/health' },
  ]);
  const endpoints = await resolveCloudflarePublicHealthEndpoints({
    accountId: 'account-123',
    apiToken: 'token-secret',
    fetchImpl: async (url) => {
      if (url.endsWith('/accounts/account-123/workers/subdomain')) {
        return json({ success: true, result: { subdomain: 'tarematsu' } });
      }
      return json({ success: true, result: { enabled: false, previews_enabled: false } });
    },
  });

  assert.equal(endpoints.length, 1);
  assert.match(endpoints[0].resolutionError, /not enabled on workers\.dev/);
  const result = await capturePublicHealthEndpoint(endpoints[0], {
    fetchImpl: async () => {
      throw new Error('endpoint fetch must not run after resolution failure');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.error, /not enabled on workers\.dev/);
});
