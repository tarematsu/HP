const UINT32_RANGE = 0x1_0000_0000;

export function pickRandomIndexExcluding(
  length,
  excludedIndex,
  randomValues = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)
) {
  const count = Math.max(0, Math.trunc(Number(length) || 0));
  if (count <= 1) return 0;
  if (typeof randomValues !== 'function') {
    throw new Error('Secure random generator is unavailable');
  }

  const excluded = Math.trunc(Number(excludedIndex));
  const hasExcluded = excluded >= 0 && excluded < count;
  const candidateCount = hasExcluded ? count - 1 : count;
  const acceptedRange = Math.floor(UINT32_RANGE / candidateCount) * candidateCount;
  const buffer = new Uint32Array(1);
  do {
    randomValues(buffer);
  } while (buffer[0] >= acceptedRange);

  const candidate = buffer[0] % candidateCount;
  return hasExcluded && candidate >= excluded ? candidate + 1 : candidate;
}
