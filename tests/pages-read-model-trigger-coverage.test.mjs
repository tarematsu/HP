import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url), 'utf8');

test('read-model rebuild is manual recovery and delegates generation to the Worker', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:|cron:|^\s*push:\s*$/m);
  assert.match(workflow, /Request canonical Worker rebuild/);
  assert.match(workflow, /request-pages-read-model-rebuild-actions\.mjs/);
  assert.doesNotMatch(workflow, /period-completeness\.js|run-pages-history-read-model-actions/);
});
