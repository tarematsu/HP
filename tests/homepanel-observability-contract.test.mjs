import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

const root = new URL('../', import.meta.url);

test('HomePanel observability is covered by the canonical unified workflow and issue', async () => {
  const workflow = readSource('.github/workflows/sh-observability.yml');
  const publisher = readSource('.github/scripts/publish-cloudflare-observability-status.mjs');
  const unifiedCi = readSource('.github/workflows/homepanel-unified-ci.yml');
  const usageDocumentation = readSource('hp/cloud/D1_USAGE_MEASUREMENT.md');

  expectAll(workflow, [
    'name: Unified Cloudflare Observability',
    'workflows: ["Deploy production", "Deploy HomePanel Cloud services"]',
    'CLOUDFLARE_WORKERS: sh-sakurazaka46jp,sh-buddies-collector,sh-runtime-orchestrator,homepanel-cloud,homepanel-video',
    'D1_CONFIG_GLOBS: worker/wrangler*.jsonc,site/wrangler.jsonc,hp/cloud/wrangler.jsonc,hp/video/wrangler.jsonc',
    'CLOUDFLARE_CONFIG_GLOBS: worker/wrangler*.jsonc,site/wrangler.jsonc,hp/cloud/wrangler.jsonc,hp/video/wrangler.jsonc',
    'CLOUDFLARE_DO_BINDINGS: BUDDIES_COLLECTOR_COORDINATOR,SCHEDULER_COORDINATOR,DEVICE_SYNC_COORDINATOR,RADAR_BUNDLE_COORDINATOR',
    'D1_QUERY_OUTPUT_DIR: d1-insights',
    'D1_INSIGHTS_OUTCOME',
    'Collect top D1 queries by rows read',
    'query-cloudflare-d1-costs.py',
    'publish-cloudflare-observability-status.mjs',
    'cloudflare-observability-report-unified-',
    'Deferring unified Cloudflare diagnostics until production deployment completes.',
  ]);
  expectAll(publisher, [
    'Cloudflare Observability Status',
    '<!-- cloudflare-observability-status -->',
    'HP + Stationhead monorepo, account-wide included usage',
    'Top D1 queries by rows read',
    "readOptionalText('d1-insights/summary.md')",
    "readOptionalText('telemetry-summary.md')",
    "readOptionalJson('active-worker-deployments.json')",
    'publishCommitStatuses',
    'upsertStatusIssue',
  ]);
  expectAll(unifiedCi, [
    'python3 .github/scripts/audit-cloudflare-daily-usage.py --self-test',
    'python3 .github/scripts/audit-cloudflare-telemetry.py --self-test',
    'python3 .github/scripts/audit-deployed-cloudflare-telemetry.py --self-test',
    'python3 .github/scripts/query-cloudflare-d1-costs.py --self-test',
    'tests/homepanel-*.test.mjs',
  ]);
  expectAll(usageDocumentation, [
    '.github/workflows/sh-observability.yml',
    'HP and Stationhead',
    'one canonical status issue',
  ]);
  expectNone(`${workflow}\n${publisher}\n${usageDocumentation}`, [
    'publish-homepanel-observability-status.mjs',
    'HomePanel Observability Status',
    '<!-- homepanel-observability-status -->',
  ]);
  assert.equal((workflow.match(/- cron:/g) || []).length, 1);
  await assert.rejects(access(new URL('.github/workflows/hp-observability.yml', root)));
  await assert.rejects(access(new URL('.github/scripts/publish-homepanel-observability-status.mjs', root)));
});
