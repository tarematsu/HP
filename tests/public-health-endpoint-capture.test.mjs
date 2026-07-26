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

test('public health capture defaults to all Stationhead health endpoints', () => {
  assert.deepEqual(publicHealthEndpoints(''), DEFAULT_PUBLIC_HEALTH_ENDPOINTS);
  assert.deepEqual(
    DEFAULT_PUBLIC_HEALTH_ENDPOINTS.map(({ url }) => url),
    [
      'https://skrzk.pages.dev/api/health',
      'https://skrzk.pages.dev/api/health/minute',
      'https://skrzk.pages.dev/api/health/other',
      'https://skrzk.pages.dev/api/health/sakurazaka46jp',
    ],
  );
});

test('public health capture renders HTTP metadata and formatted JSON bodies', async () => {
  const result = await capturePublicHealthEndpoint(
    { name: 'Minute pipeline', url: 'https://skrzk.pages.dev/api/health/minute' },
    {
      timeoutMs: 1_000,
      bodyLimit: 2_000,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json; charset=utf-8' },
        text: async () => '{"ok":true,"lag":3}',
      }),
    },
  );
  assert.equal(result.ok, true);
  assert.match(result.body, /\n  "lag": 3/);
  const report = renderPublicHealthReport([result], '2026-07-26T00:00:00.000Z');
  assert.match(report, /Public health endpoint snapshots/);
  assert.match(report, /https:\/\/skrzk\.pages\.dev\/api\/health\/minute/);
  assert.match(report, /200 OK/);
  assert.match(report, /"lag": 3/);
});

test('public health capture preserves failed responses and truncates oversized bodies', async () => {
  const result = await capturePublicHealthEndpoint(
    { name: 'Other pipeline', url: 'https://skrzk.pages.dev/api/health/other' },
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

test('observability diagnostics action publishes public health snapshots into the status issue', () => {
  const root = new URL('../', import.meta.url);
  const action = readFileSync(new URL('.github/actions/cloudflare-observability-diagnostics/action.yml', root), 'utf8');
  const publisher = readFileSync(new URL('.github/scripts/publish-cloudflare-observability-status.mjs', root), 'utf8');
  assert.match(action, /capture-public-health-endpoints\.mjs/);
  assert.match(action, /wait "\$health_pid" \|\| health_status=\$\?/);
  assert.match(action, /public-health-endpoints\.md/);
  assert.match(publisher, /readOptionalText\('public-health-endpoints\.md'\)/);
  assert.match(publisher, /Public application health endpoint snapshots/);
});
