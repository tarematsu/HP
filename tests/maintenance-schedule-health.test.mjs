import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function cron(workflow) {
  return workflow.match(/cron:\s*['"]([^'"]+)['"]/)?.[1] || '';
}

test('runtime follows Pages without a reciprocal workflow cycle', () => {
  const runtime = read('.github/workflows/run-runtime-offline-maintenance.yml');
  const pages = read('.github/workflows/run-pages-read-model-rebuild.yml');

  assert.equal(cron(runtime), '11,41 * * * *');
  assert.equal(cron(pages), '26,56 * * * *');
  assert.match(runtime, /workflows: \["Deploy production", "Rebuild pages read models"\]/);
  assert.doesNotMatch(pages, /workflow_run:/);
  assert.match(runtime, /cancel-in-progress: false/);
  assert.match(pages, /group: pages-read-model-rebuild/);
});

test('Pages read models rerun when their Cloudflare account dependency changes', () => {
  const pages = read('.github/workflows/run-pages-read-model-rebuild.yml');

  assert.match(pages, /- '\.github\/actions\/cloudflare-context\/action\.yml'/);
  assert.match(pages, /- '\.github\/scripts\/resolve-cloudflare-account\.mjs'/);
  assert.match(pages, /uses: \.\/\.github\/actions\/cloudflare-context/);
});

test('public runtime health has one schedule half-cycle of grace after runner warning', () => {
  const config = JSON.parse(read('site/wrangler.jsonc'));
  const healthSource = read('site/functions/lib/health-other.js');
  const runnerPolicy = read('.github/scripts/github-actions-runner-health.mjs');

  assert.equal(config.vars.OTHER_CRON_STALE_MS, 90 * 60_000);
  assert.match(healthSource, /90 \* 60_000/);
  assert.match(runnerPolicy, /name: 'Runtime offline maintenance'[\s\S]*?staleAfterMinutes: 75/);
});
