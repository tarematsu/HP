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
  assert.match(workflow, /^\s+actions: read$/m);
  assert.match(publisher, /shouldPublishObservabilityStatus/);
  assert.match(publisher, /if \(!isCurrentMainTarget\(targetSha, mainSha\)\)/);
  assert.match(publisher, /Skip stale observability issue/);
});

test('collection integrity audit still runs when telemetry audit fails', () => {
  const start = workflow.indexOf('- name: Enforce current-deployment telemetry and collection integrity');
  const end = workflow.indexOf('- name: Audit R2 collection freshness', start);
  assert.ok(start >= 0 && end > start, 'telemetry integrity step must exist');
  const block = workflow.slice(start, end);
  const pipefail = block.indexOf('set -o pipefail');
  const noExit = block.indexOf('set +e');
  const telemetry = block.indexOf('python3 .github/scripts/audit-deployed-cloudflare-telemetry.py');
  const collection = block.indexOf('node .github/scripts/audit-observability-collection.mjs');
  const aggregateFailure = block.indexOf('if (( telemetry_status != 0 || collection_status != 0 )); then');
  assert.ok(pipefail >= 0 && pipefail < noExit && noExit < telemetry);
  assert.ok(telemetry < collection && collection < aggregateFailure);
});
