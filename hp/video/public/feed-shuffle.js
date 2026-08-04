const MAX_FEED_SEED = 2_147_483_646;
const UINT32_RANGE = 0x1_0000_0000;
const FALLBACK_SEED = 0x6d2b79f5;

export function createFeedSeed(randomValues = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)) {
  if (typeof randomValues !== 'function') {
    throw new Error('Secure random generator is unavailable');
  }
  const buffer = new Uint32Array(1);
  randomValues(buffer);
  return buffer[0] % MAX_FEED_SEED + 1;
}

export function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  if (!state) state = FALLBACK_SEED;
  return () => {
    state = (state + FALLBACK_SEED) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function shuffleFeedItems(items, seed, previousFirstId = null, skipAttempts = 0) {
  const shuffled = [...(items || [])];
  const random = createSeededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  if (previousFirstId !== null && previousFirstId !== undefined && shuffled.length > 1) {
    const previousIndex = shuffled.findIndex((item) => String(item?.id) === String(previousFirstId));
    if (previousIndex >= 0) {
      const [previousItem] = shuffled.splice(previousIndex, 1);
      const insertionIndex = Math.min(
        Math.max(1, Math.trunc(Number(skipAttempts) || 0)),
        shuffled.length
      );
      shuffled.splice(insertionIndex, 0, previousItem);
    }
  }
  return shuffled;
}
