import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const auditPath = '.github/scripts/audit-cloudflare-free-tier-account.py';
const audit = readFileSync(new URL(`../${auditPath}`, import.meta.url), 'utf8');
const workflow = readFileSync(
  new URL('../.github/workflows/sh-observability.yml', import.meta.url),
  'utf8',
);

test('account-wide budget audit is independent of configured DO binding count', () => {
  const result = spawnSync('python3', [auditPath, '--self-test'], {
    cwd: rootPath,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLOUDFLARE_DO_BINDINGS: 'RUNTIME_COORDINATOR,BUDDIES_COLLECTOR_COORDINATOR',
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /account-wide discovery-free audit self-test passed/);
  assert.match(audit, /configured_resource_ids/);
});

test('observability covers both coordinators without Pipelines configuration', () => {
  assert.match(
    workflow,
    /python3 \.github\/scripts\/audit-cloudflare-free-tier-account\.py 2>&1/,
  );
  assert.match(
    workflow,
    /CLOUDFLARE_CONFIG_GLOBS: worker\/wrangler\.runtime\.jsonc,worker\/wrangler\.buddies-collector\.jsonc/,
  );
  assert.match(
    workflow,
    /CLOUDFLARE_DO_BINDINGS: RUNTIME_COORDINATOR,BUDDIES_COLLECTOR_COORDINATOR/,
  );
  assert.doesNotMatch(workflow, /CLOUDFLARE_PIPELINE_NAMES|Pipelines included-usage/);
  assert.doesNotMatch(audit, /PIPELINE_NAMES|pipelines\/v1\/pipelines/);
});
