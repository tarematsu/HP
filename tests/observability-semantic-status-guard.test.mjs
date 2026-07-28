import assert from 'node:assert/strict';
import test from 'node:test';

import { issueBodyMatchesPublishedRun } from '../.github/scripts/observability-workflow-outcome.mjs';

const targetSha = 'abc123';
const runUrl = 'https://github.com/tarematsu/HP/actions/runs/123';
const body = `<!-- cloudflare-observability-status -->
# Cloudflare Observability Status

- **Cloudflare status:** success · **Generated:** 2026-07-28T10:00:00.000Z
- **Workflow run:** ${runUrl} · **Workflow source commit:** \`${targetSha}\` · **Current main SHA:** \`${targetSha}\``;

test('semantic overall requires the persistent Issue from the same run and SHA', () => {
  assert.equal(issueBodyMatchesPublishedRun(body, { targetSha, runUrl }), true);
  assert.equal(issueBodyMatchesPublishedRun(body, { targetSha: 'other', runUrl }), false);
  assert.equal(issueBodyMatchesPublishedRun(body, {
    targetSha,
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/999',
  }), false);
  assert.equal(issueBodyMatchesPublishedRun('', { targetSha, runUrl }), false);
});
