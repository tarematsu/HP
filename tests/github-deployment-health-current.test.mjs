import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCurrentDeploymentError,
  summarizeCurrentHomePanelDeployment,
} from '../.github/scripts/github-deployment-health-current.mjs';

function run(conclusion = 'success') {
  return {
    id: 10,
    run_number: 10,
    status: 'completed',
    conclusion,
    head_sha: 'abcdef123456',
    updated_at: '2026-07-28T00:00:00Z',
    html_url: 'https://github.com/tarematsu/HP/actions/runs/10',
  };
}

function job(conclusion = 'success', steps = []) {
  return { id: 20, name: 'deploy', status: 'completed', conclusion, steps };
}

test('HomePanel deployment diagnostics use current cloud deployment and Queue cutover step names', () => {
  const summary = summarizeCurrentHomePanelDeployment({
    run: run(),
    jobs: [job('success', [
      { name: 'Release manual import Queue consumer — Delete retired homepanel-video Worker', conclusion: 'success' },
      { name: 'Deploy HomePanel Cloud', conclusion: 'success' },
    ])],
  });
  assert.equal(summary.overall, 'success');
  assert.deepEqual(summary.components.map((entry) => entry.target), [
    'homepanel-cloud',
    'retired homepanel-video deletion',
  ]);
  assert.ok(!summary.components.some((entry) => entry.target === 'homepanel-video'));
});

test('missing expected deployment step is degraded even when the job itself succeeds', () => {
  const summary = summarizeCurrentHomePanelDeployment({
    run: run(),
    jobs: [job('success', [
      { name: 'Deploy HomePanel Cloud', conclusion: 'success' },
    ])],
  });
  assert.equal(summary.overall, 'degraded');
  const deletion = summary.components.find((entry) => entry.target === 'retired homepanel-video deletion');
  assert.equal(deletion.result, 'unknown');
  assert.match(deletion.error, /Expected deployment step/);
});

test('failure after deployment steps is exposed as post-deploy verification failure', () => {
  const summary = summarizeCurrentHomePanelDeployment({
    run: run('failure'),
    jobs: [job('failure', [
      { name: 'Release manual import Queue consumer — Delete retired homepanel-video Worker', conclusion: 'success' },
      { name: 'Deploy HomePanel Cloud', conclusion: 'success' },
      { name: 'Verify deployed readiness', conclusion: 'failure' },
    ])],
    jobError: 'readiness verification failed',
  });
  assert.equal(summary.overall, 'failure');
  const verification = summary.components.find((entry) => entry.target === 'post-deploy verification');
  assert.equal(verification.result, 'failure');
  assert.match(verification.error, /readiness verification failed/);
});

test('retired Worker deletion failure blocks rather than misreports the unified deployment', () => {
  const summary = summarizeCurrentHomePanelDeployment({
    run: run('failure'),
    jobs: [job('failure', [
      { name: 'Release manual import Queue consumer — Delete retired homepanel-video Worker', conclusion: 'failure' },
      { name: 'Deploy HomePanel Cloud', conclusion: 'skipped' },
    ])],
    jobError: 'delete API rejected the request',
  });
  assert.equal(summary.overall, 'failure');
  assert.equal(summary.components[0].target, 'homepanel-cloud');
  assert.equal(summary.components[0].result, 'skipped');
  assert.equal(summary.components[1].target, 'retired homepanel-video deletion');
  assert.equal(summary.components[1].result, 'failure');
});

test('explicit HomePanel root cause wins over later artifact upload chatter', () => {
  const error = extractCurrentDeploymentError(`
2026-07-28T14:13:18Z ##[error]HomePanel deploy failed::Some triggers failed to deploy: Queue consumer already exists
2026-07-28T14:13:19Z name: homepanel-deploy-failure-123
2026-07-28T14:13:19Z Artifact homepanel-deploy-failure-123.zip successfully finalized.
2026-07-28T14:13:19Z Process completed with exit code 1.
  `);
  assert.match(error, /Queue consumer already exists/);
  assert.doesNotMatch(error, /Artifact|successfully finalized/);
});
