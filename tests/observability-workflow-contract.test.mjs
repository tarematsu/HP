import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/sh-observability.yml', root), 'utf8');
const resolver = readFileSync(new URL('.github/scripts/observability-workflow-outcome.mjs', root), 'utf8');

test('workflow conclusion follows semantic current-main observability outcome', () => {
  assert.match(workflow, /name: Resolve semantic observability outcome/);
  assert.match(workflow, /id: resolve-outcome/);
  assert.match(workflow, /name: Publish semantic observability overall status/);
  assert.match(workflow, /id: publish-overall/);
  assert.match(workflow, /steps\.resolve-outcome\.outputs\.current_main_target == 'true'/);
  assert.match(workflow, /steps\.resolve-outcome\.outputs\.overall == 'failure'/);
  assert.match(workflow, /steps\.publish-status\.outcome == 'failure'/);
  assert.match(workflow, /steps\.publish-overall\.outcome == 'failure'/);

  const finalDecision = workflow.slice(workflow.indexOf('- name: Fail when current-main observability remains unhealthy'));
  assert.doesNotMatch(finalDecision, /steps\.(?:daily-budget|free-tier-budget|budget-contract|d1-insights|telemetry-policy)\.outcome/);
  assert.doesNotMatch(finalDecision, /steps\.observability-query\.outputs\.query-outcome/);
});

test('semantic decision precedes Issue mutation and overall status publication follows it', () => {
  const resolveIndex = workflow.indexOf('Resolve semantic observability outcome');
  const issuePublishIndex = workflow.indexOf('Publish persistent observability status');
  const overallPublishIndex = workflow.indexOf('Publish semantic observability overall status');

  assert.ok(resolveIndex >= 0 && resolveIndex < issuePublishIndex);
  assert.ok(issuePublishIndex < overallPublishIndex);
  assert.match(workflow, /node \.github\/scripts\/observability-workflow-outcome\.mjs --publish-status/);
  assert.match(workflow, /OBSERVABILITY_OVERALL: \$\{\{ steps\.resolve-outcome\.outputs\.overall \}\}/);

  assert.match(resolver, /observabilityIssueOverall/);
  assert.match(resolver, /findStatusIssue/);
  assert.match(resolver, /context: 'observability\/overall'/);
  assert.match(resolver, /writeOutput\('current_main_target'/);
  assert.match(resolver, /writeOutput\('overall'/);
  assert.match(resolver, /process\.argv\.includes\('--publish-status'\)/);
});
