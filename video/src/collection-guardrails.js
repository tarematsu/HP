export const SOURCE_TIMEOUTS_MS = Object.freeze({
  'source-a-browser': 120_000,
  'source-b-browser': 120_000,
  'source-e-browser': 120_000
});

export const DEFAULT_SOURCE_TIMEOUT_MS = 120_000;
export const OVERALL_COLLECTION_TIMEOUT_MS = 300_000;

export class CollectionTimeoutError extends Error {
  constructor(scope, timeoutMs) {
    super(`${scope} timed out after ${timeoutMs} ms`);
    this.name = 'CollectionTimeoutError';
    this.code = 'COLLECTION_TIMEOUT';
    this.scope = scope;
    this.timeoutMs = timeoutMs;
  }
}

export function timeoutForMethod(method) {
  return SOURCE_TIMEOUTS_MS[method] || DEFAULT_SOURCE_TIMEOUT_MS;
}

export function isCollectionTimeout(error) {
  return error?.code === 'COLLECTION_TIMEOUT'
    || error?.name === 'CollectionTimeoutError';
}

export async function runWithCollectionTimeout(task, options = {}) {
  const timeoutMs = Math.max(1, Math.floor(Number(options.timeoutMs) || DEFAULT_SOURCE_TIMEOUT_MS));
  const scope = options.scope || 'collection';
  const controller = new AbortController();
  let settled = false;
  let rejectTimeout;

  const timeoutPromise = new Promise((_, reject) => {
    rejectTimeout = reject;
  });

  const abortWith = (reason) => {
    if (controller.signal.aborted || settled) return;
    const error = reason instanceof Error
      ? reason
      : new CollectionTimeoutError(scope, timeoutMs);
    controller.abort(error);
    rejectTimeout(error);
  };

  const onParentAbort = () => {
    abortWith(options.parentSignal?.reason || new CollectionTimeoutError('overall collection', timeoutMs));
  };

  if (options.parentSignal?.aborted) onParentAbort();
  else options.parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const timer = setTimeout(() => {
    abortWith(new CollectionTimeoutError(scope, timeoutMs));
  }, timeoutMs);

  const taskPromise = Promise.resolve().then(() => task(controller.signal));

  try {
    return await Promise.race([taskPromise, timeoutPromise]);
  } finally {
    settled = true;
    clearTimeout(timer);
    options.parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

export function createOverallCollectionGuard(timeoutMs = OVERALL_COLLECTION_TIMEOUT_MS) {
  const durationMs = Math.max(1, Math.floor(Number(timeoutMs) || OVERALL_COLLECTION_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new CollectionTimeoutError('overall collection', durationMs));
  }, durationMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
    }
  };
}
