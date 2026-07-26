import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deploymentWorkflow = readFileSync(
  new URL('../.github/workflows/deploy-split-pipeline.yml', import.meta.url),
  'utf8',
);

test('runtime deployment also redeploys Pages for binding cutover and retry', () => {
  assert.match(
    deploymentWorkflow,
    /if jq -e '\.workers \| index\("sh-runtime-orchestrator"\) != null' <<<"\$selection" >\/dev\/null; then\s+pages=true\s+fi/,
  );
});
