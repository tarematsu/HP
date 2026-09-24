import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('Pages edge-cache hit benchmark remains lightweight', () => {
  const stdout = execFileSync(process.execPath, ['scripts/benchmark-pages-response-cache-hit.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.benchmark, 'Pages internal response edge-cache hit');
  assert.equal(result.iterations, 10000);
  assert.equal(result.milliseconds_per_invocation > 0, true);
  assert.equal(result.milliseconds_per_invocation < 1, true);
});
