import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const audit = readFileSync(new URL('../../scripts/audit-pages-materialized.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../.github/workflows/pages-live-browser-audit.yml', import.meta.url), 'utf8');

test('production materialized audit checks every bounded API variant', () => {
  assert.match(audit, /MATERIALIZED_API_VARIANTS/);
  assert.match(audit, /for \(const variant of MATERIALIZED_API_VARIANTS\)/);
  assert.match(audit, /payload\.ok !== true/);
  assert.match(audit, /used fallback path/);
  assert.match(audit, /x-api-source/);
  assert.match(audit, /x-materialized-at/);
  assert.match(audit, /is stale by/);
});

test('production audit is strict after deploy and read-model rebuild', () => {
  assert.match(workflow, /workflows: \['Deploy production', 'Rebuild pages read models'\]/);
  assert.match(workflow, /Require all production materializations/);
  assert.match(workflow, /--attempts="\$attempts"/);
  assert.match(workflow, /retry_delay_ms=30000/);
  assert.match(workflow, /continue-on-error: \$\{\{ github\.event_name == 'pull_request' \}\}/);
});
