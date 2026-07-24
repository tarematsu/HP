export function collectionAbortError(signal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Collection aborted');
}

export function throwIfCollectionAborted(signal) {
  const error = collectionAbortError(signal);
  if (error) throw error;
}
