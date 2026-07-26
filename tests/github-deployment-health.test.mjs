import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DEPLOYMENT_HEALTH_START,
  extractDeploymentError,
  mergeDeploymentHistory,
  parseDeploymentTargets,
  renderDeploymentHealthSummary,
  replaceDeploymentHealthSection,
  summarizeDeploymentRun,
  workerDeploymentResults,
} from '../.github/scripts/github-deployment-health.mjs';

const productionTarget = { name: 'Deploy production', workflow: 'deploy-split-pipeline.yml', kind: 'stationhead' };
const homepanelTarget = { name: 'Deploy HomePanel Cloud services', workflow: 'cloud-deploy.yml', kind: 'homepanel' };

function run(id, conclusion = 'failure') {
  return {
    id,
    run_number: id,
    status: 'completed',
    conclusion,
    head_sha: `abcdef${id}`,
    updated_at: `2026-07-27T01:${String(id).padStart(2, '0')}:00Z`,
    html_url: `https://github.com/tarematsu/HP/actions/runs/${id}`,
  };
}

test('stable target marker exposes Pages and every selected Worker', () => {
  const targets = parseDeploymentTargets(`
 echo "DEPLOYMENT_TARGETS_JSON=$deployment_targets"
 DEPLOYMENT_TARGETS_JSON={"minute_db":true,"pages":true,"workers":["sh-sakurazaka46jp","sh-buddies-recovery","sh-buddies-collector","sh-runtime-orchestrator"],"commands":["deploy:sakurazaka46jp","deploy:buddies-recovery","deploy:buddies-collector","deploy:runtime"]}
`);
  assert.equal(targets.minute_db, true);
  assert.equal(targets.pages, true);
  assert.equal(targets.workers.length, 4);
});

test('legacy select-job JSON still exposes selected Workers', () => {
  const targets = parseDeploymentTargets(`
{
  "workers": ["sh-runtime-orchestrator"],
  "commands": ["deploy:runtime"]
}`);
  assert.deepEqual(targets.workers, ['sh-runtime-orchestrator']);
  assert.deepEqual(targets.commands, ['deploy:runtime']);
});

test('deployment errors are compact and sanitized', () => {
  const error = extractDeploymentError(`
##[error]Wrangler deploy failed
API_TOKEN=secret-value
Process completed with exit code 1.
`);
  assert.match(error, /Wrangler deploy failed/);
  assert.match(error, /exit code 1/);
  assert.doesNotMatch(error, /secret-value/);
});

test('sequential Worker logs distinguish succeeded, failed, and blocked deployments', () => {
  const results = workerDeploymentResults(`
Deploying deploy:sakurazaka46jp
Deploying deploy:buddies-recovery
Deploying deploy:buddies-collector
`, [
    'deploy:sakurazaka46jp',
    'deploy:buddies-recovery',
    'deploy:buddies-collector',
    'deploy:runtime',
  ], 'failure');
  assert.deepEqual(results, {
    'deploy:sakurazaka46jp': 'success',
    'deploy:buddies-recovery': 'success',
    'deploy:buddies-collector': 'failure',
    'deploy:runtime': 'skipped',
  });
});

test('worker-only runs do not replace Pages history with a skipped row', () => {
  const summary = summarizeDeploymentRun({
    target: productionTarget,
    run: run(1, 'success'),
    targets: {
      pages: false,
      workers: ['sh-runtime-orchestrator'],
      commands: ['deploy:runtime'],
    },
    jobs: [
      { id: 1, name: 'Deploy affected Workers', conclusion: 'success', status: 'completed' },
      { id: 2, name: 'Build and deploy Pages', conclusion: 'skipped', status: 'completed' },
    ],
    workerResults: { 'deploy:runtime': 'success' },
  });
  assert.deepEqual(summary.components.map((component) => component.target), ['sh-runtime-orchestrator']);
});

test('Pages blocked by an upstream failure is not reported as the source error', () => {
  const summary = summarizeDeploymentRun({
    target: productionTarget,
    run: run(2),
    targets: { pages: true, workers: [], commands: [] },
    jobs: [
      { id: 10, name: 'Apply MINUTE_DB migrations before deployment', conclusion: 'failure', status: 'completed' },
      { id: 11, name: 'Build and deploy Pages', conclusion: 'skipped', status: 'completed' },
    ],
    jobErrors: { 10: 'migration failed' },
  });
  const pages = summary.components.find((component) => component.target === 'Cloudflare Pages (skrzk)');
  assert.equal(pages.result, 'skipped');
  assert.match(pages.error, /Blocked by an upstream deployment failure/);
  assert.match(pages.error, /migration failed/);
});

test('history merge retains the latest targeted attempt for every Worker and Pages', () => {
  const summaries = [
    {
      run: run(5, 'success'),
      components: [{ workflow: 'Deploy production', target: 'sh-runtime-orchestrator', result: 'success', error: '', run: run(5, 'success') }],
    },
    {
      run: run(4),
      components: [{ workflow: 'Deploy production', target: 'Cloudflare Pages (skrzk)', result: 'failure', error: 'pages failed', run: run(4) }],
    },
    {
      run: run(3, 'success'),
      components: [
        { workflow: 'Deploy production', target: 'sh-buddies-recovery', result: 'success', error: '', run: run(3, 'success') },
        { workflow: 'Deploy production', target: 'sh-buddies-collector', result: 'success', error: '', run: run(3, 'success') },
      ],
    },
    {
      run: run(2, 'success'),
      components: [{ workflow: 'Deploy production', target: 'sh-sakurazaka46jp', result: 'success', error: '', run: run(2, 'success') }],
    },
  ];
  const merged = mergeDeploymentHistory(summaries);
  assert.equal(merged.components.filter((component) => component.target.startsWith('sh-')).length, 4);
  assert.equal(merged.components.find((component) => component.target === 'Cloudflare Pages (skrzk)').result, 'failure');
  assert.equal(merged.overall, 'failure');
});

test('HomePanel deployment summary uses individual deploy steps', () => {
  const summary = summarizeDeploymentRun({
    target: homepanelTarget,
    run: run(9),
    jobs: [{
      id: 9,
      name: 'deploy',
      conclusion: 'failure',
      steps: [
        { name: 'Deploy private video service', conclusion: 'success' },
        { name: 'Deploy HomePanel gateway', conclusion: 'failure' },
      ],
    }],
    jobErrors: { 9: 'homepanel-cloud deploy failed' },
  });
  assert.equal(summary.components[0].result, 'success');
  assert.equal(summary.components[1].result, 'failure');
});

test('deployment health block is rendered and replaced without duplication', () => {
  const first = renderDeploymentHealthSummary([
    summarizeDeploymentRun({ target: homepanelTarget, run: run(9), jobs: [] }),
  ], { generatedAt: '2026-07-27T01:10:00Z' });
  const body = replaceDeploymentHealthSection(
    '<!-- cloudflare-observability-status -->\n# Status\n\n## Immediate triage\nOK',
    first,
  );
  assert.match(body, new RegExp(DEPLOYMENT_HEALTH_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const replaced = replaceDeploymentHealthSection(body, first.replace('01:10', '01:20'));
  assert.equal((replaced.match(/github-deployment-health:start/g) || []).length, 1);
  assert.match(replaced, /01:20/);
});


test('production workflow emits a stable deployment target marker', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-split-pipeline.yml', import.meta.url), 'utf8');
  assert.match(workflow, /DEPLOYMENT_TARGETS_JSON=\$deployment_targets/);
});
