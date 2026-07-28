import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  summarizeHomePanelDeployFailure,
} from '../.github/scripts/summarize-homepanel-deploy-failure.mjs';

const root = new URL('../', import.meta.url);

test('HomePanel deploy failure summary keeps the root cause and removes npm wrappers', () => {
  const summary = summarizeHomePanelDeployFailure(`
    ✘ [ERROR] A request to the Cloudflare API (/accounts/example/workers/scripts/homepanel-cloud) failed.
    Queue 'videoscraper-manual-imports' was not found [code: 11002]
    npm error location /home/runner/work/HP/HP/hp/cloud
    npm error command failed
    npm error command sh -c node scripts/deploy-existing.mjs --without-migrations
    Process completed with exit code 1.
  `);
  assert.match(summary, /Queue 'videoscraper-manual-imports' was not found/);
  assert.match(summary, /11002/);
  assert.doesNotMatch(summary, /npm error location|npm error command sh -c|Process completed/);
});

test('HomePanel deploy failure summary redacts credentials', () => {
  const summary = summarizeHomePanelDeployFailure(`
    Error: Authorization: Bearer secret-token
    CLOUDFLARE_API_TOKEN=another-secret
  `);
  assert.match(summary, /\[redacted\]/);
  assert.doesNotMatch(summary, /secret-token|another-secret/);
});

test('HomePanel deploy workflow captures and uploads the sanitized failure evidence', () => {
  const workflow = readFileSync(new URL('.github/workflows/cloud-deploy.yml', root), 'utf8');
  assert.match(workflow, /2>&1 \| tee "\$deploy_log"/);
  assert.match(workflow, /summarize-homepanel-deploy-failure\.mjs/);
  assert.match(workflow, /Upload HomePanel deployment failure log/);
  assert.match(workflow, /homepanel-deploy-failure-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /if-no-files-found: ignore/);
});
