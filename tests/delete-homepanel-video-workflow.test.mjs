import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/delete-homepanel-video.yml', import.meta.url),
  'utf8',
);

test('retired HomePanel video deletion is production-only and idempotent', () => {
  assert.match(workflow, /^name: Delete retired HomePanel Video Worker$/m);
  assert.match(workflow, /^  push:\n/m);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /^  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /^  pull_request:\n/m);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /wrangler delete --name homepanel-video --force/);
  assert.match(workflow, /not found\|does not exist\|404\|10090/);
  assert.match(workflow, /exit "\$status"/);
});
