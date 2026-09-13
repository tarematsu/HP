import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const workflow = source('.github/workflows/homepanel-unified-ci.yml');
const reporter = source('.github/workflows/homepanel-ci-failure-report.yml');
const quietRunner = source('.github/scripts/ci/run-quiet.sh');

test('HomePanel validation keeps successful command output out of Actions logs', () => {
  assert.match(workflow, /\.github\/scripts\/ci\/run-quiet\.sh/);
  assert.doesNotMatch(workflow, /\|\s*tee\b/);
  assert.match(workflow, /hp\/install\.log/);
  assert.match(workflow, /hp\/cloud\/unified-bundle\.log/);
  assert.match(workflow, /Upload failed validation output/);
});

test('quiet runner emits only a bounded failure excerpt while preserving the full log', () => {
  assert.match(quietRunner, />"\$log_file" 2>&1/);
  assert.match(quietRunner, /--- CI failure excerpt ---/);
  assert.match(quietRunner, /hits\[-6:\]/);
  assert.match(quietRunner, /len\(ordered\) > 48/);
  assert.match(quietRunner, /full log is in the failed-CI artifact/);
});

test('failure reporter avoids duplicating full log tails in pull request comments', () => {
  assert.match(reporter, /failedJobs\.slice\(0, 3\)/);
  assert.match(reporter, /slice\(-48\)/);
  assert.match(reporter, /body\.length > 14000/);
  assert.doesNotMatch(reporter, /\*\*Log tail\*\*/);
});
