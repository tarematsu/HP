import { execFileSync as defaultExecFileSync } from 'node:child_process';

import { transientWranglerD1Failure } from './remote-d1-adapter.mjs';

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 2_000;

export function wranglerCommandFailureDetail(error) {
  const stderr = String(error?.stderr || '').trim();
  const stdout = String(error?.stdout || '').trim();
  return stderr || stdout || String(error?.message || error || '').trim();
}

export function transientWranglerCommandFailure(error) {
  const detail = wranglerCommandFailureDetail(error);
  return transientWranglerD1Failure(error)
    || /not currently import at bookmark/i.test(detail)
    || /database is currently unavailable|temporarily unavailable/i.test(detail)
    || /\bHTTP\s+(?:408|425|429|5\d\d)\b/i.test(detail);
}

function defaultSleepSync(milliseconds) {
  if (!(milliseconds > 0)) return;
  const state = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(state, 0, 0, milliseconds);
}

function defaultRetryLogger({ attempt, attempts, delayMs, detail }) {
  console.warn(
    `Wrangler transient failure; retrying in ${delayMs}ms `
      + `(attempt ${attempt}/${attempts}): ${detail.slice(0, 500)}`,
  );
}

export function runWranglerCommandWithRetry({
  command,
  args = [],
  options = {},
  execFileSync = defaultExecFileSync,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleepSync = defaultSleepSync,
  onRetry = defaultRetryLogger,
}) {
  if (!String(command || '').trim()) throw new Error('Wrangler command is required');
  if (!Array.isArray(args)) throw new TypeError('Wrangler command args must be an array');
  if (typeof execFileSync !== 'function') throw new TypeError('execFileSync implementation is required');
  if (typeof sleepSync !== 'function') throw new TypeError('sleepSync implementation is required');
  if (typeof onRetry !== 'function') throw new TypeError('retry callback is required');

  const retryCount = Math.max(0, Math.min(5, Math.trunc(Number(maxRetries)) || 0));
  const baseDelayMs = Math.max(0, Math.min(30_000, Math.trunc(Number(retryDelayMs)) || 0));
  const attempts = retryCount + 1;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return execFileSync(command, args, options);
    } catch (cause) {
      const detail = wranglerCommandFailureDetail(cause);
      if (index >= retryCount || !transientWranglerCommandFailure(cause)) {
        const error = new Error(`Wrangler command failed${detail ? `: ${detail.slice(0, 4000)}` : ''}`);
        error.cause = cause;
        throw error;
      }
      const delayMs = baseDelayMs * (2 ** index);
      onRetry({
        attempt: index + 2,
        attempts,
        delayMs,
        detail,
      });
      sleepSync(delayMs);
    }
  }
  throw new Error('Wrangler command exhausted retries');
}
