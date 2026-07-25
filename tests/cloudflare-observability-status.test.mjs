import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  STATUS_MARKER,
  buildIssueBody,
} from '../.github/scripts/publish-cloudflare-observability-status.mjs';

const root = new URL('../', import.meta.url);

test('SH observability issue body includes deployment context and sanitized diagnostics', () => {
  const body = buildIssueBody({
    generatedAt: '2026-07-23T01:00:00.000Z',
    targetSha: 'abcdef123456',
    mainSha: 'fedcba654321',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/123',
    trigger: 'schedule',
    outcomes: {
      daily: 'success',
      freeTier: 'failure',
      contract: 'success',
      query: 'success',
      telemetry: 'success',
    },
    summaries: {
      daily: '## Daily usage\n\nD1 rows read: 10',
      freeTier: '## Included usage\n\nQueue operations: 20',
      telemetry: 'TELEMETRY_AUDIT={"authorization":"Bearer secret-value"}',
    },
    activeDeployments: {
      'sh-runtime-orchestrator': {
        deployment_id: 'deployment-123',
        version_ids: ['version-a'],
        created_on: '2026-07-23T00:55:00Z',
      },
    },
    recentMerges: [{
      number: 591,
      title: 'Deploy runtime after migrations',
      merge_commit_sha: 'merge-sha-591',
      merged_at: '2026-07-23T00:50:00Z',
    }],
  });

  assert.match(body, new RegExp(STATUS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, /\*\*Overall:\*\* failure/);
  assert.match(body, /\| freeTier \| failure \|/);
  assert.doesNotMatch(body, /\| policy \|/);
  assert.match(body, /Workflow source commit:\*\* `abcdef123456`/);
  assert.match(body, /Current main SHA:\*\* `fedcba654321`/);
  assert.match(body, /deployment-123/);
  assert.match(body, /version-a/);
  assert.match(body, /#591 Deploy runtime after migrations/);
  assert.match(body, /Queue operations: 20/);
  assert.match(body, /Current-deployment telemetry policy/);
  assert.match(body, /TELEMETRY_AUDIT/);
  assert.match(body, /Bearer \[redacted\]/);
  assert.doesNotMatch(body, /secret-value/);
});

test('SH observability publishes retrievable deployment and telemetry status', async () => {
  const workflow = await readFile(
    new URL('.github/workflows/sh-observability.yml', root),
    'utf8',
  );
  const publisher = await readFile(
    new URL('.github/scripts/publish-cloudflare-observability-status.mjs', root),
    'utf8',
  );

  assert.match(workflow, /^\s{2}issues: write$/m);
  assert.match(workflow, /^\s{2}statuses: write$/m);
  assert.match(workflow, /ACTIVE_WORKER_DEPLOYMENTS_OUTPUT: active-worker-deployments\.json/);
  assert.match(workflow, /active-worker-deployments\.json/);
  assert.match(workflow, /telemetry-audit\.log/);
  assert.match(workflow, /OBSERVABILITY_TARGET_SHA:/);
  assert.match(workflow, /OBSERVABILITY_MAIN_REF: main/);
  assert.match(workflow, /cloudflare-observability-report-sh-/);
  assert.match(publisher, /readOptionalText\('telemetry-audit\.log'\)/);
  assert.match(publisher, /Current-deployment telemetry policy/);
  assert.doesNotMatch(
    `${workflow}\n${publisher}`,
    /POLICY_OUTCOME|policy-self-test|observability\/policy-self-test|--self-test|node --test/,
  );
  assert.doesNotMatch(publisher, /normalizeOutcome|statusState|function selfTest|node:assert/);
});