import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/sh-observability.yml', 'utf8');

test('observability runs serialize only at the status-writing job', () => {
  assert.doesNotMatch(workflow, /cloudflare-observability-unified-/);
  assert.match(workflow, /observability:\n[\s\S]*?concurrency:\n\s+group: cloudflare-observability-status-issue\n\s+cancel-in-progress: false/);
});
