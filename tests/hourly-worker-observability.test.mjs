import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const video = JSON.parse(readFileSync(
  new URL('../hp/video/wrangler.jsonc', import.meta.url),
  'utf8',
));

test('video Worker persists invocation telemetry without a Cloudflare Cron', () => {
  assert.equal(video.triggers, undefined);
  assert.equal(video.observability?.enabled, true);
  assert.equal(video.observability?.head_sampling_rate, 1);
  assert.equal(video.observability?.logs?.enabled, true);
  assert.equal(video.observability?.logs?.head_sampling_rate, 1);
  assert.equal(video.observability?.logs?.persist, true);
  assert.equal(video.observability?.logs?.invocation_logs, true);
});
