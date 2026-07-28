import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

test('HomePanel deployment diagnostics use current cloud deployment and retired Worker deletion step names', () => {
  const summary = summarizeCurrentHomePanelDeployment({
    run: run(),
    jobs: [job('success', [
      { name: 'Deploy HomePanel Cloud', conclusion: 'success' },
      { name: 'Deploy private video service deletion — Delete retired homepanel-video Worker', conclusion: 'success' },
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
      { name: 'Deploy HomePanel Cloud', conclusion: 'success' },
      { name: 'Deploy private video service deletion — Delete retired homepanel-video Worker', conclusion: 'success' },
      { name: 'Verify deployed readiness', conclusion: 'failure' },
    ])],
    jobError: 'readiness verification failed',
  });
  assert.equal(summary.overall, 'failure');
  const verification = summary.components.find((entry) => entry.target === 'post-deploy verification');
  assert.equal(verification.result, 'failure');
  assert.match(verification.error, /readiness verification failed/);
});

test('retired Worker deletion failure is not misreported as an active service deployment', () => {
  const summary = summarizeCurrentHomePanelDeployment({
    run: run('failure'),
    jobs: [job('failure', [
      { name: 'Deploy HomePanel Cloud', conclusion: 'success' },
      { name: 'Deploy private video service deletion — Delete retired homepanel-video Worker', conclusion: 'failure' },
    ])],
    jobError: 'delete API rejected the request',
  });
  assert.equal(summary.overall, 'failure');
  assert.equal(summary.components[0].result, 'success');
  assert.equal(summary.components[1].target, 'retired homepanel-video deletion');
  assert.equal(summary.components[1].result, 'failure');
});
