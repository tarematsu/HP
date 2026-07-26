import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compat = readFileSync(
  new URL('../.github/scripts/cloudflare_queue_dimension_compat.py', import.meta.url),
  'utf8',
);
const entry = readFileSync(
  new URL('../.github/scripts/audit-cloudflare-free-tier.py', import.meta.url),
  'utf8',
);

test('Queue audit adapts GraphQL dimension names without disabling budget enforcement', () => {
  assert.match(entry, /from cloudflare_queue_dimension_compat import main, self_test/);
  assert.match(compat, /queueID: queueId/);
  assert.match(compat, /dimensions \{ actionType consumerType \}/);
  assert.match(compat, /dimensions \{ actionType \}/);
  assert.match(compat, /unknown field/);
  assert.match(compat, /return core\.main\(\)/);
  assert.match(compat, /finally:\s*\n\s*core\.api = original_api/);
});
