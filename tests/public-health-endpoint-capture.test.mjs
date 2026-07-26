import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DEFAULT_PUBLIC_HEALTH_ENDPOINTS,
  capturePublicHealthEndpoint,
  formatResponseBody,
  publicHealthEndpoints,
  renderPublicHealthReport,
} from '../.github/scripts/capture-public-health-endpoints.mjs';

test('public health capture defaults to the unified Stationhead health endpoint', () => {
  assert.deepEqual(publicHealthEndpoints(''), DEFAULT_PUBLIC_HEALTH_ENDPOINTS);
  assert.deepEqual(DEFAULT_PUBLIC_HEALTH_ENDPOINTS, [
    { name: 'Unified health', url: 'https://skrzk.pages.dev/api/health' },
  ]);
});

test('public health capture renders HTTP metadata and formatted JSON bodies', async () => {
  const result = await capturePublicHealthEndpoint(
    { name: 'Unified health', url: 'https://skrzk.pages.dev/api/health' },
    {
      timeoutMs: 1_000,
      bodyLimit: 8_000,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json; charset=utf-8' },
        text: async () => '{"ok":true,"components":{"minute":{"ok":true}}}',
      }),
    },
  );
  assert.equal(result.ok, true);
  assert.match(result.body, /"minute"/);
  const report = renderPublicHealthReport([result], '2026-07-26T00:00:00.000Z');
  assert.match(report, /Public health endpoint snapshots/);
  assert.match(report, /https:\/\/skrzk\.pages\.dev\/api\/health/);
  assert.match(report, /200 OK/);
});

test('public health capture preserves failed responses and truncates oversized bodies', async () => {
  const result = await capturePublicHealthEndpoint(
    { name: 'Unified health', url: 'https://skrzk.pages.dev/api/health' },
    {
      timeoutMs: 1_000,
      bodyLimit: 20,
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { get: () => 'text/plain' },
        text: async () => 'x'.repeat(100),
      }),
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.body, /response body truncated/);
  assert.match(renderPublicHealthReport([result]), /503 Service Unavailable/);
  assert.equal(formatResponseBody('not-json', 'application/json'), 'not-json');
});

test('observability diagnostics action publishes and retains public health snapshots', () => {
  const root = new URL('../', import.meta.url);
  const action = readFileSync(new URL('.github/actions/cloudflare-observability-diagnostics/action.yml', root), 'utf8');
  const workflow = readFileSync(new URL('.github/workflows/sh-observability.yml', root), 'utf8');
  const publisher = readFileSync(new URL('.github/scripts/publish-cloudflare-observability-status.mjs', root), 'utf8');
  assert.match(action, /capture-public-health-endpoints\.mjs/);
  assert.match(action, /wait "\$health_pid" \|\| health_status=\$\?/);
  assert.match(action, /public-health-endpoints\.md/);
  assert.match(workflow, /^\s{6}- '\.github\/scripts\/capture-public-health-endpoints\.mjs'$/m);
  assert.match(workflow, /^\s{12}public-health-endpoints\.md$/m);
  assert.match(workflow, /^\s{12}public-health-endpoints\.log$/m);
  assert.match(publisher, /readOptionalText\('public-health-endpoints\.md'\)/);
  assert.match(publisher, /Public application health endpoint snapshots/);
});
