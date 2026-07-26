import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  STATUS_MARKER,
  buildIssueBody,
} from '../.github/scripts/publish-cloudflare-observability-status.mjs';

const root = new URL('../', import.meta.url);

test('unified observability issue body includes HP and Stationhead deployment context', () => {
  const body = buildIssueBody({
    generatedAt: '2026-07-25T01:00:00.000Z',
    targetSha: 'abcdef123456',
    mainSha: 'fedcba654321',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/123',
    trigger: 'schedule',
    lookbackMinutes: '60',
    outcomes: {
      daily: 'success',
      freeTier: 'failure',
      contract: 'success',
      d1Insights: 'success',
      query: 'success',
      telemetry: 'success',
    },
    summaries: {
      daily: '## Daily usage\n\nD1 rows read: 10',
      freeTier: '## Included usage\n\nQueue operations: 20',
      d1Insights: '## D1 query cost insights\n\nDatabases: 4',
      telemetry: 'Authorization: Bearer secret-value',
    },
    activeDeployments: {
      'sh-runtime-orchestrator': {
        status: 'active',
        deployment_id: 'deployment-sh',
        version_ids: ['version-sh'],
        created_on: '2026-07-25T00:55:00Z',
      },
      'homepanel-cloud': {
        status: 'active',
        deployment_id: 'deployment-hp',
        version_ids: ['version-hp'],
        created_on: '2026-07-25T00:56:00Z',
      },
      'homepanel-video': {
        status: 'active',
        deployment_id: 'deployment-video',
        version_ids: ['version-video'],
        created_on: '2026-07-25T00:56:30Z',
      },
    },
    recentMerges: [{
      number: 261,
      title: 'Fix observability diagnostics',
      merge_commit_sha: 'merge-sha-261',
      merged_at: '2026-07-25T00:50:00Z',
    }],
  });

  assert.match(body, new RegExp(STATUS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, /\*\*Overall:\*\* failure/);
  assert.match(body, /Scope:\*\* HP \+ Stationhead monorepo, account-wide included usage/);
  assert.match(body, /\| d1Insights \| success \|/);
  assert.match(body, /Workflow source commit:\*\* `abcdef123456`/);
  assert.match(body, /Current main SHA:\*\* `fedcba654321`/);
  assert.match(body, /deployment-sh/);
  assert.match(body, /deployment-hp/);
  assert.match(body, /deployment-video/);
  assert.match(body, /version-sh/);
  assert.match(body, /version-hp/);
  assert.match(body, /version-video/);
  assert.match(body, /#261 Fix observability diagnostics/);
  assert.match(body, /Top D1 queries by rows read/);
  assert.match(body, /Databases: 4/);
  assert.match(body, /Bearer \[redacted\]/);
  assert.doesNotMatch(body, /secret-value/);
});

test('unified workflow publishes one retrievable account-wide status', async () => {
  const workflow = await readFile(
    new URL('.github/workflows/sh-observability.yml', root),
    'utf8',
  );
  const publisher = await readFile(
    new URL('.github/scripts/publish-cloudflare-observability-status.mjs', root),
    'utf8',
  );

  assert.match(workflow, /workflows: \["Deploy production", "Deploy HomePanel Cloud services"\]/);
  assert.match(workflow, /CLOUDFLARE_WORKERS: sh-sakurazaka46jp,sh-buddies-collector,sh-runtime-orchestrator,homepanel-cloud,homepanel-video/);
  assert.match(workflow, /D1_CONFIG_GLOBS: worker\/wrangler\*\.jsonc,site\/wrangler\.jsonc,hp\/cloud\/wrangler\.jsonc,hp\/video\/wrangler\.jsonc/);
  assert.match(workflow, /CLOUDFLARE_DO_BINDINGS: BUDDIES_COLLECTOR_COORDINATOR,SCHEDULER_COORDINATOR,DEVICE_SYNC_COORDINATOR,RADAR_BUNDLE_COORDINATOR/);
  assert.match(workflow, /D1_INSIGHTS_OUTCOME:/);
  assert.match(workflow, /cloudflare-observability-report-unified-/);
  assert.match(workflow, /ACTIVE_WORKER_DEPLOYMENTS_OUTPUT: active-worker-deployments\.json/);
  assert.match(publisher, /readOptionalText\('d1-insights\/summary\.md'\)/);
  assert.match(publisher, /readOptionalText\('telemetry-summary\.md'\)/);
  assert.match(publisher, /HP \+ Stationhead monorepo/);
  assert.match(publisher, /Top D1 queries by rows read/);
  assert.doesNotMatch(
    `${workflow}\n${publisher}`,
    /publish-homepanel-observability-status|HomePanel Observability Status|homepanel-observability-status/,
  );
});
