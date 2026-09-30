import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('Cloudflare observability refresh helper is watchdog-dispatched instead of independently scheduled', () => {
  const workflow = readSource('.github/workflows/refresh-cloudflare-observability.yml');

  expectAll(workflow, [
    'name: Refresh Cloudflare observability',
    'workflow_dispatch:',
    'actions: write',
    'actions/github-script@v7',
    'github.rest.actions.createWorkflowDispatch',
    "workflow_id: 'sh-observability.yml'",
    "ref: context.payload.repository?.default_branch || 'main'",
    "lookback_minutes: '60'",
    "- '.github/workflows/refresh-cloudflare-observability.yml'",
  ]);

  expectNone(workflow, [
    'schedule:',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_BUILDS_API_TOKEN',
    'wrangler d1 execute',
    'query-cloudflare-d1-costs.py',
  ]);

  assert.equal((workflow.match(/- cron:/g) || []).length, 0);
  assert.equal((workflow.match(/createWorkflowDispatch/g) || []).length, 1);
});
