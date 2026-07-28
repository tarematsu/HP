import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SYSTEM_STATUS_MARKER,
  observabilitySystemStatus,
  synchronizeObservabilitySystemStatus,
} from '../.github/scripts/observability-system-status.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function issue({ cloudflare = 'success', runner = 'healthy', deployment = 'success' } = {}) {
  return `<!-- cloudflare-observability-status -->
# Cloudflare Observability Status

- **Cloudflare status:** ${cloudflare} · **Generated:** 2026-07-28T00:00:00Z
- **Scope:** HP + Stationhead monorepo, account-wide included usage

<!-- github-actions-runner-health:start -->
### GitHub Actions runner health
- **Overall:** ${runner}
<!-- github-actions-runner-health:end -->

<!-- github-deployment-health:start -->
### GitHub deployment health
- **Overall:** ${deployment}
<!-- github-deployment-health:end -->`;
}

test('system status fails when any Cloudflare, runner, or deployment component fails', () => {
  assert.equal(observabilitySystemStatus(issue()).overall, 'success');
  assert.equal(observabilitySystemStatus(issue({ runner: 'failure' })).overall, 'failure');
  assert.equal(observabilitySystemStatus(issue({ deployment: 'degraded' })).overall, 'failure');
  assert.equal(observabilitySystemStatus(issue({ cloudflare: 'failure' })).overall, 'failure');
});

test('missing health blocks remain pending instead of being reported as success', () => {
  const body = issue().replace(/<!-- github-deployment-health:start -->[\s\S]*?<!-- github-deployment-health:end -->/, '');
  const status = observabilitySystemStatus(body);
  assert.equal(status.overall, 'pending');
  assert.equal(status.components.deployment, 'pending');
});

test('system status synchronization inserts one current line and replaces stale values', () => {
  const failed = synchronizeObservabilitySystemStatus(issue({ runner: 'failure' }));
  assert.match(failed, /\*\*System status:\*\* failure/);
  assert.match(failed, /\*\*Actions runner:\*\* failure/);
  assert.equal((failed.match(new RegExp(SYSTEM_STATUS_MARKER, 'g')) || []).length, 1);

  const recovered = synchronizeObservabilitySystemStatus(
    failed.replace('- **Overall:** failure', '- **Overall:** healthy'),
  );
  assert.match(recovered, /\*\*System status:\*\* success/);
  assert.equal((recovered.match(new RegExp(SYSTEM_STATUS_MARKER, 'g')) || []).length, 1);
});

test('every status writer synchronizes the unified system line', () => {
  const outcome = read('.github/scripts/observability-workflow-outcome.mjs');
  const runnerWorkflow = read('.github/workflows/publish-github-actions-runner-health.yml');
  const deploymentWorkflow = read('.github/workflows/publish-github-deployment-health.yml');
  assert.match(outcome, /publishObservabilitySystemStatusFromEnvironment/);
  assert.match(runnerWorkflow, /observability-system-status\.mjs/);
  assert.match(deploymentWorkflow, /observability-system-status\.mjs/);
});
