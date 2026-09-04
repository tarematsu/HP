import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/sh-observability.yml', 'utf8');
const publisher = readFileSync('.github/scripts/publish-cloudflare-observability-status.mjs', 'utf8');

test('observability runs are not cancelled by workflow or job concurrency', () => {
  assert.doesNotMatch(workflow, /cloudflare-observability-unified-/);
  assert.doesNotMatch(workflow, /cloudflare-observability-status-issue/);
  assert.doesNotMatch(workflow, /cancel-in-progress:/);
});

test('stale observability runs cannot overwrite the current-main issue', () => {
  assert.match(publisher, /if \(!isCurrentMainTarget\(targetSha, mainSha\)\)/);
  assert.match(publisher, /Skip stale observability issue/);
});
