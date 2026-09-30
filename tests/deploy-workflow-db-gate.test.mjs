import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/deploy-split-pipeline.yml', import.meta.url),
  'utf8',
);

test('deployment workflow changes redeploy Workers without forcing MINUTE_DB verification', () => {
  const minuteDbCondition = workflow.match(/if grep -Eq '([^']+)' changed-files\.txt; then\n\s+minute_db=true/)?.[1] || '';
  assert.match(minuteDbCondition, /\.github\/workflows\/database/);
  assert.doesNotMatch(minuteDbCondition, /deploy-split-pipeline/);
});

test('OTHER_DB migrations are applied before Workers that consume the new schema', () => {
  assert.match(workflow, /database\/other-migrations\/\*\*/);
  const otherDbCondition = workflow.match(/if grep -Eq '([^']+)' changed-files\.txt; then\n\s+other_db=true/)?.[1] || '';
  assert.match(otherDbCondition, /database\/other-migrations/);
  assert.match(otherDbCondition, /provision-other-db/);
  assert.match(otherDbCondition, /other-db-tables/);
  assert.match(otherDbCondition, /deploy-split-pipeline/);
  assert.match(workflow, /other_db:\n\s+name: Apply OTHER_DB migrations before deployment/);
  assert.match(workflow, /operation: other-db/);
  assert.match(workflow, /needs: \[select, minute_db, other_db\]/);
  assert.match(workflow, /needs\.other_db\.result == 'success' \|\| needs\.other_db\.result == 'skipped'/);
});
