export function normalizedIsrc(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[-\s]/g, '');
}

export function metadataValuePresent(value) {
  return value != null && String(value).trim() !== '';
}
