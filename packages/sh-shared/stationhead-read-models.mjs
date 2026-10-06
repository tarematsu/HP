export const STATIONHEAD_READ_MODEL_KEYS = Object.freeze({
  buddies: 'dashboard',
  ohisama: 'hinata',
  nogizaka: 'nogizaka-listening-party',
});

export function stationheadReadModelKey(sourceValue) {
  const source = String(sourceValue || '').trim().toLowerCase();
  return STATIONHEAD_READ_MODEL_KEYS[source] || null;
}
