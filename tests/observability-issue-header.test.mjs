import assert from 'node:assert/strict';
import test from 'node:test';

import {
  replaceObservabilityCurrentMainSha,
  resolveObservabilityMainSha,
} from '../.github/scripts/observability-issue-header.mjs';

test('lightweight observability writers refresh only the current main SHA header field', () => {
  const body = `<!-- cloudflare-observability-status -->
# Cloudflare Observability Status

- **Workflow run:** https://github.com/tarematsu/HP/actions/runs/1 · **Workflow source commit:** \`source-sha\` · **Current main SHA:** \`old-main\`

## Detailed diagnostics
old-main remains valid diagnostic text`;
  const updated = replaceObservabilityCurrentMainSha(body, 'new-main');
  assert.match(updated, /Workflow source commit:\*\* `source-sha`/);
  assert.match(updated, /Current main SHA:\*\* `new-main`/);
  assert.match(updated, /old-main remains valid diagnostic text/);
});

test('main SHA replacement is a no-op for unavailable values and malformed bodies', () => {
  const body = '# Status without a main marker';
  assert.equal(replaceObservabilityCurrentMainSha(body, 'abc'), body);
  assert.equal(replaceObservabilityCurrentMainSha(body, 'unknown'), body);
});

test('main SHA resolver uses the selected ref and fails closed to unknown', async () => {
  const calls = [];
  const sha = await resolveObservabilityMainSha(async (method, path) => {
    calls.push([method, path]);
    return { sha: 'resolved-main' };
  }, { ref: 'main' });
  assert.equal(sha, 'resolved-main');
  assert.deepEqual(calls, [['GET', '/commits/main']]);

  assert.equal(await resolveObservabilityMainSha(async () => {
    throw new Error('unavailable');
  }), 'unknown');
});
