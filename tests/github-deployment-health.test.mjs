import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPLOYMENT_HEALTH_START,
  extractDeploymentError,
  parseDeploymentTargets,
  renderDeploymentHealthSummary,
  replaceDeploymentHealthSection,
  summarizeDeploymentRun,
  workerDeploymentResults,
} from '../.github/scripts/github-deployment-health.mjs';
import { buildDeploymentHealthIssueBody } from '../.github/scripts/publish-github-deployment-health.mjs';

const productionTarget = {
  name: 'Deploy production',
  workflow: 'deploy-split-pipeline.yml',
  kind: 'stationhead',
};

const homepanelTarget = {
  name: 'Deploy HomePanel Cloud services',
  workflow: 'cloud-deploy.yml',
  kind: 'homepanel',
};

const run = {
  id: 123,
  run_number: 44,
  status: 'completed',
  conclusion: 'failure',
  head_sha: 'abcdef1234567890',
  updated_at: '2026-07-27T01:00:00Z',
  html_url: 'https://github.com/tarematsu/HP/actions/runs/123',
};

test('deployment target marker exposes Pages and every selected Worker', () => {
  const targets = parseDeploymentTargets(`2026-07-27T00:00:00Z DEPLOYMENT_TARGETS_JSON={"minute_db":true,"pages":true,"workers":["sh-sakurazaka46jp","sh-buddies-recovery","sh-buddies-collector","sh-runtime-orchestrator"],"commands":[]}`);
  assert.equal(targets.minute_db, true);
  assert.equal(targets.pages, true);
  assert.deepEqual(targets.workers, [
    'sh-sakurazaka46jp',
    'sh-buddies-recovery',
    'sh-buddies-collector',
    'sh-runtime-orchestrator',
  ]);
});

test('legacy select-job JSON still exposes selected Workers', () => {
  const targets = parseDeploymentTargets(`
2026-07-27T00:00:00Z {
2026-07-27T00:00:00Z   "workers": [
2026-07-27T00:00:00Z     "sh-runtime-orchestrator"
2026-07-27T00:00:00Z   ],
2026-07-27T00:00:00Z   "commands": ["deploy:runtime"]
2026-07-27T00:00:00Z }
`);
  assert.deepEqual(targets.workers, ['sh-runtime-orchestrator']);
  assert.deepEqual(targets.commands, ['deploy:runtime']);
});

test('deployment errors are compact and sanitized', () => {
  const error = extractDeploymentError(`
2026-07-27T00:00:00Z ##[error]Wrangler deploy failed
2026-07-27T00:00:01Z API_TOKEN=secret-value
2026-07-27T00:00:02Z Process completed with exit code 1.
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

test('production deployment summary lists Pages and all selected Workers', () => {
  const result = summarizeDeploymentRun({
    target: productionTarget,
    run,
    targets: {
      minute_db: false,
      pages: true,
      workers: ['sh-buddies-recovery', 'sh-buddies-collector'],
      commands: ['deploy:buddies-recovery', 'deploy:buddies-collector'],
    },
    jobs: [
      { id: 1, name: 'Deploy affected Workers', conclusion: 'failure', status: 'completed' },
      { id: 2, name: 'Build and deploy Pages', conclusion: 'skipped', status: 'completed' },
    ],
    jobErrors: { 1: 'deploy:buddies-collector failed' },
    workerResults: {
      'deploy:buddies-recovery': 'success',
      'deploy:buddies-collector': 'failure',
    },
  });
  assert.equal(result.overall, 'failure');
  assert.deepEqual(result.components.map((component) => component.target), [
    'sh-buddies-recovery',
    'sh-buddies-collector',
    'Cloudflare Pages (skrzk)',
  ]);
  assert.equal(result.components[0].result, 'success');
  assert.equal(result.components[1].result, 'failure');
  assert.equal(result.components[2].result, 'skipped');
});

test('HomePanel deployment summary uses individual deploy steps', () => {
  const result = summarizeDeploymentRun({
    target: homepanelTarget,
    run,
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
  assert.equal(result.components[0].result, 'success');
  assert.equal(result.components[1].result, 'failure');
});

test('deployment health block is rendered and replaced without duplicating it', () => {
  const first = renderDeploymentHealthSummary([
    summarizeDeploymentRun({ target: homepanelTarget, run, jobs: [] }),
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

test('deployment publisher clips its section to fit a near-limit observability issue', () => {
  const issueBody = `<!-- cloudflare-observability-status -->
# Status
${'x'.repeat(62_000)}
## Immediate triage`;
  const body = buildDeploymentHealthIssueBody(issueBody, `### Deployment
${'y'.repeat(10_000)}`);
  assert.ok(body.length <= 65_000);
  assert.match(body, /github-deployment-health:start/);
});
