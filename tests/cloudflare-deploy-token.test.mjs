import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/deploy-split-pipeline.yml', import.meta.url),
  'utf8',
);

test('production deployment uses the shared Cloudflare context resolver', () => {
  const action = 'uses: ./.github/actions/cloudflare-context';
  assert.ok(workflow.split(action).length - 1 >= 2);
  assert.match(workflow, /secrets\.CLOUDFLARE_BUILDS_API_TOKEN/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_ACCOUNT_ID:\s*['\"]?[0-9a-f]{32}/i);
});
