import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runnerPublisher = readFileSync(
  new URL('../.github/scripts/publish-github-actions-runner-health.mjs', import.meta.url),
  'utf8',
);
const deploymentPublisher = readFileSync(
  new URL('../.github/scripts/publish-github-deployment-health.mjs', import.meta.url),
  'utf8',
);

test('both lightweight observability writers synchronize the issue main SHA', () => {
  assert.match(runnerPublisher, /resolveObservabilityMainSha\(request\)/);
  assert.match(runnerPublisher, /replaceObservabilityCurrentMainSha\(issue\.body, mainSha\)/);
  assert.match(deploymentPublisher, /replaceObservabilityCurrentMainSha\(issue\.body, releaseStatus\?\.main\?\.sha\)/);
});
