import assert from 'node:assert/strict';
import test from 'node:test';

import { runHotPathBenchmark } from '../scripts/benchmark-hot-path.mjs';

test('hot-path benchmark reports stable machine-readable metrics', async () => {
  const result = await runHotPathBenchmark({ warmup: 2, samples: 2, iterations: 3 });

  assert.equal(result.measuredInvocations, 6);
  assert.equal(result.benchmark, 'entry-core warm GET /api/videos response-cache hit');
  assert.equal(result.millisecondsPerInvocation.mean > 0, true);
  assert.equal(result.millisecondsPerInvocation.p50 > 0, true);
  assert.equal(result.millisecondsPerInvocation.p95 > 0, true);
  assert.match(result.note, /not Cloudflare billed CPU time/);
});
