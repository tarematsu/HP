import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { WORKFLOW_HEALTH_BY_KEY } from '../.github/scripts/workflow-health-policy.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function cron(workflow) {
  return workflow.match(/cron:\s*['"]([^'"]+)['"]/)?.[1] || '';
}

test('repair layers use isolated lightweight, four-hour, and daily cadences', () => {
  const runtime = read('.github/workflows/run-runtime-offline-maintenance.yml');
  const dataRepair = read('.github/workflows/run-data-integrity-repair.yml');
  const dailyDeep = read('.github/workflows/run-daily-deep-repair.yml');
  const metadata = read('.github/workflows/run-track-metadata-repair.yml');
  const pages = read('.github/workflows/run-pages-read-model-rebuild.yml');
  const repair = read('.github/workflows/repair-pages-summaries.yml');

  assert.equal(cron(runtime), '11,41 * * * *');
  assert.equal(cron(dataRepair), '31 */4 * * *');
  assert.equal(cron(dailyDeep), '46 0 * * *');
  assert.equal(cron(metadata), '16 0 * * *');
  assert.equal(cron(pages), '26 0 * * *');
  assert.equal(cron(repair), '23 4 * * *');

  assert.match(runtime, /RUNTIME_MAINTENANCE_COLLECTOR_ID: other-cron/);
  assert.match(runtime, /RUNTIME_MAINTENANCE_LIGHT_ONLY: 'true'/);
  assert.match(runtime, /RUNTIME_MAINTENANCE_SKIP_REBUILD: 'true'/);
  assert.doesNotMatch(runtime, /publish-recent-daily-summaries-actions\.mjs/);
  assert.doesNotMatch(runtime, /detect-pages-read-model-revision-drift-actions\.mjs/);
  assert.doesNotMatch(runtime, /run-minute-facts-gap-scan-actions\.mjs/);

  assert.match(dataRepair, /run-minute-facts-gap-scan-actions\.mjs/);
  assert.match(dataRepair, /run-runtime-offline-maintenance-actions\.mjs/);
  assert.match(dataRepair, /RUNTIME_MAINTENANCE_COLLECTOR_ID: data-integrity-repair-actions/);
  assert.match(dataRepair, /RUNTIME_MAINTENANCE_REBUILD_ONLY: 'true'/);
  assert.match(dataRepair, /RUNTIME_MAINTENANCE_FORCE: 'true'/);
  assert.doesNotMatch(dataRepair, /publish-recent-daily-summaries-actions\.mjs/);
  assert.doesNotMatch(dataRepair, /detect-pages-read-model-revision-drift-actions\.mjs/);
  assert.doesNotMatch(dataRepair, /PAGES_RESPONSE_BUCKET/);

  assert.match(dailyDeep, /RUNTIME_MAINTENANCE_COLLECTOR_ID: daily-deep-repair-actions/);
  assert.match(dailyDeep, /RUNTIME_MAINTENANCE_SKIP_REBUILD: 'true'/);
  assert.match(dailyDeep, /publish-recent-daily-summaries-actions\.mjs/);
  assert.match(dailyDeep, /detect-pages-read-model-revision-drift-actions\.mjs/);
  assert.match(dailyDeep, /steps\.pages-revision-drift\.outputs\.due_keys != ''/);

  assert.doesNotMatch(runtime, /^\s*push:\s*$/m);
  assert.doesNotMatch(dataRepair, /^\s*push:\s*$/m);
  assert.doesNotMatch(dailyDeep, /^\s*push:\s*$/m);
  assert.match(metadata, /^\s*push:\s*$/m);
  assert.match(metadata, /branches: \[main\]/);
  assert.match(metadata, /worker\/scripts\/repair-playback-read-model-actions\.mjs/);
  assert.doesNotMatch(metadata, /workflow_run:/);
  assert.doesNotMatch(pages, /workflow_run:/);
  assert.match(runtime, /cancel-in-progress: false/);
  assert.match(dataRepair, /cancel-in-progress: false/);
  assert.match(dailyDeep, /cancel-in-progress: false/);
  assert.match(pages, /group: pages-read-model-rebuild/);
  assert.doesNotMatch(pages, /github\.event_name == 'schedule'\s*\|\|/);
  assert.doesNotMatch(pages, /repair-pages-summary-gaps\.mjs|repair-single-sample-stream-summaries\.mjs/);
  assert.match(repair, /repair-single-sample-stream-summaries\.mjs/);
  assert.match(repair, /repair-pages-summary-gaps\.mjs/);
});

test('Pages read models rerun when their Cloudflare account dependency changes', () => {
  const pages = read('.github/workflows/run-pages-read-model-rebuild.yml');

  assert.match(pages, /- '\.github\/actions\/cloudflare-context\/action\.yml'/);
  assert.match(pages, /- '\.github\/scripts\/resolve-cloudflare-account\.mjs'/);
  assert.match(pages, /uses: \.\/\.github\/actions\/cloudflare-context/);
});

test('runtime maintenance freshness is diagnostic after the runner warning', () => {
  const config = JSON.parse(read('site/wrangler.jsonc'));
  const healthSource = read('site/functions/lib/health-other.js');
  const runtimePolicy = WORKFLOW_HEALTH_BY_KEY.runtime;

  assert.equal(config.vars.OTHER_CRON_STALE_MS, 90 * 60_000);
  assert.match(healthSource, /75 \* 60_000/);
  assert.match(healthSource, /ok: Boolean\(row\) && !failed/);
  assert.equal(runtimePolicy.name, 'Runtime offline maintenance');
  assert.equal(runtimePolicy.cadenceMinutes, 30);
  assert.equal(runtimePolicy.staleAfterMinutes, 75);
});

test('heavy repair and deep repair health match their lower frequencies', () => {
  const dataRepair = WORKFLOW_HEALTH_BY_KEY.dataRepair;
  const dailyDeep = WORKFLOW_HEALTH_BY_KEY.dailyDeep;
  const metadata = WORKFLOW_HEALTH_BY_KEY.metadata;
  const pages = WORKFLOW_HEALTH_BY_KEY.pages;

  assert.equal(dataRepair.cadenceMinutes, 240);
  assert.equal(dataRepair.staleAfterMinutes, 330);
  assert.equal(dailyDeep.cadenceMinutes, 1440);
  assert.equal(dailyDeep.staleAfterMinutes, 1500);
  assert.equal(metadata.cadenceMinutes, 1440);
  assert.equal(metadata.staleAfterMinutes, 1500);
  assert.equal(pages.cadenceMinutes, 1440);
  assert.equal(pages.staleAfterMinutes, 1500);
  assert.equal(WORKFLOW_HEALTH_BY_KEY.localMinute, undefined);
});
