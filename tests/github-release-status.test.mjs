import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  nativeReleaseRequired,
  renderNativeReleaseSummary,
  summarizeNativeRelease,
} from '../.github/scripts/github-release-status.mjs';

function run(id, conclusion = 'success', headSha = `sha-${id}`, status = 'completed') {
  return {
    id,
    run_number: id,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    head_sha: headSha,
    updated_at: `2026-07-27T02:${String(id).padStart(2, '0')}:00Z`,
    html_url: `https://github.com/tarematsu/HP/actions/runs/${id}`,
  };
}

function releaseJob() {
  return {
    id: 81,
    name: 'build',
    conclusion: 'success',
    steps: [
      { name: 'Build native project with warnings as errors', conclusion: 'success' },
      { name: 'Package native release', conclusion: 'success' },
      { name: 'Upload update assets to R2', conclusion: 'success' },
      { name: 'Trigger immediate update rollout', conclusion: 'success' },
      { name: 'Upload native release package', conclusion: 'success' },
    ],
  };
}

test('native release requirement follows the workflow path contract', () => {
  assert.equal(nativeReleaseRequired([{ filename: 'hp/native/src/app.cpp' }]), true);
  assert.equal(nativeReleaseRequired([{ filename: '.github/workflows/native-windows-build.yml' }]), true);
  assert.equal(nativeReleaseRequired([{ filename: 'hp/cloud/src/sources.ts' }]), false);
});

test('successful R2 publication proves a required native release reached distribution', () => {
  const current = run(82, 'success', 'current-sha');
  const status = summarizeNativeRelease({
    mainCommit: {
      sha: 'current-sha',
      html_url: 'https://github.com/tarematsu/HP/commit/current-sha',
      commit: { message: 'Ship native release (#400)' },
      files: [{ filename: 'hp/native/src/app.cpp' }],
    },
    currentRun: current,
    activeRun: current,
    run: current,
    jobs: [releaseJob()],
    artifacts: [{ name: 'homepanel-native-windows', expired: false }],
  });

  assert.equal(status.required, true);
  assert.equal(status.verdict, 'released');
  assert.equal(status.stages.publish.result, 'success');
  assert.equal(status.stages.rollout.result, 'success');
  assert.equal(status.stages.artifact.result, 'success');
});

test('required native release is pending until the matching main run completes', () => {
  const pending = run(83, 'success', 'current-sha', 'in_progress');
  const status = summarizeNativeRelease({
    mainCommit: {
      sha: 'current-sha',
      commit: { message: 'Native change (#402)' },
      files: [{ filename: 'hp/native/src/app.cpp' }],
    },
    currentRun: pending,
    activeRun: run(80, 'success', 'released-sha'),
    run: pending,
  });
  assert.equal(status.verdict, 'pending');
  assert.equal(status.stages.workflow.result, 'in_progress');
  assert.equal(status.stages.publish.result, 'pending');
});

test('non-native main merges retain the active native release evidence', () => {
  const active = run(80, 'success', 'released-sha');
  const status = summarizeNativeRelease({
    mainCommit: {
      sha: 'current-sha',
      commit: { message: 'Cloud-only change (#401)' },
      files: [{ filename: 'hp/cloud/src/sources.ts' }],
    },
    activeRun: active,
    run: active,
    jobs: [releaseJob()],
    artifacts: [{ name: 'homepanel-native-windows', expired: false }],
  });

  assert.equal(status.required, false);
  assert.match(status.verdict, /not required/);
  const summary = renderNativeReleaseSummary(status, { generatedAt: '2026-07-27T02:30:00Z' });
  assert.match(summary, /Active successful native release/);
  assert.match(summary, /released-sha/);
  assert.match(summary, /R2 update assets/);
});

test('deployment diagnostics refresh on every main merge and native release completion', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/publish-github-deployment-health.yml', import.meta.url),
    'utf8',
  );
  const publisher = await readFile(
    new URL('../.github/scripts/publish-github-deployment-health.mjs', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /workflows: \["Deploy production", "Deploy HomePanel Cloud services", "Native Windows Build", "Unified Cloudflare Observability"\]/);
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]\s*\n\s*schedule:/);
  assert.match(publisher, /collectNativeReleaseStatus/);
  assert.match(publisher, /renderNativeReleaseSummary/);
});
