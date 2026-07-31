import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  runWranglerCommandWithRetry,
  transientWranglerCommandFailure,
  wranglerCommandFailureDetail,
} from '../worker/scripts/wrangler-command-retry.mjs';

test('Wrangler D1 import bookmark conflicts are transient', () => {
  const error = new Error('command failed');
  error.stderr = 'Not currently import at bookmark 00000150-000014a6.';
  assert.equal(transientWranglerCommandFailure(error), true);
  assert.match(wranglerCommandFailureDetail(error), /bookmark/);

  const permanent = new Error('command failed');
  permanent.stderr = 'D1_ERROR: no such table: sh_missing';
  assert.equal(transientWranglerCommandFailure(permanent), false);
});

test('Wrangler commands retry transient failures with bounded exponential delays', () => {
  let attempts = 0;
  const delays = [];
  const retries = [];
  const transient = new Error('command failed');
  transient.stderr = 'Not currently import at bookmark 00000150-000014a6.';

  const output = runWranglerCommandWithRetry({
    command: process.execPath,
    args: ['wrangler.js', 'd1', 'execute'],
    maxRetries: 2,
    retryDelayMs: 100,
    sleepSync(delayMs) { delays.push(delayMs); },
    onRetry(retry) { retries.push(retry); },
    execFileSync() {
      attempts += 1;
      if (attempts < 3) throw transient;
      return 'migration applied';
    },
  });

  assert.equal(output, 'migration applied');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
  assert.deepEqual(retries.map(({ attempt }) => attempt), [2, 3]);
  assert.deepEqual(retries.map(({ attempts: total }) => total), [3, 3]);
});

test('Wrangler commands do not retry permanent SQL failures', () => {
  let attempts = 0;
  const delays = [];
  assert.throws(
    () => runWranglerCommandWithRetry({
      command: process.execPath,
      args: ['wrangler.js', 'd1', 'execute'],
      sleepSync(delayMs) { delays.push(delayMs); },
      onRetry() {},
      execFileSync() {
        attempts += 1;
        const error = new Error('command failed');
        error.stderr = 'D1_ERROR: no such table: sh_missing';
        throw error;
      },
    }),
    /no such table: sh_missing/,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
});

test('FACTS schema deployment captures Wrangler output before classifying retries', () => {
  const source = readFileSync(
    new URL('../worker/scripts/apply-facts-pr-schema.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /runWranglerCommandWithRetry/);
  assert.match(source, /maxRetries: 2/);
  assert.match(source, /retryDelayMs: 2_000/);
  assert.match(source, /\['ignore', 'pipe', 'pipe'\]/);
  assert.match(source, /'--file', migrationPath/);
});
