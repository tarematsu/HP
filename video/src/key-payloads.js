const DEFAULT_MAX_PAYLOAD_BYTES = 1_000_000;
const DEFAULT_MAX_ITEMS = 2000;
const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

export function createJsonKeyPayloads(items, options = {}) {
  const maxBytes = Math.max(64, Number(options.maxBytes) || DEFAULT_MAX_PAYLOAD_BYTES);
  const maxItems = Math.max(1, Number(options.maxItems) || DEFAULT_MAX_ITEMS);
  const payloads = [];
  let keys = [];
  let payloadBytes = 2;

  for (const item of items || []) {
    const key = String(item?.key || '');
    if (!key) continue;
    const serialized = JSON.stringify(key);
    const serializedBytes = byteLength(serialized);
    const addedBytes = serializedBytes + (keys.length ? 1 : 0);
    if (keys.length && (keys.length >= maxItems || payloadBytes + addedBytes > maxBytes)) {
      payloads.push(JSON.stringify(keys));
      keys = [];
      payloadBytes = 2;
    }
    keys.push(key);
    payloadBytes += serializedBytes + (keys.length > 1 ? 1 : 0);
  }

  if (keys.length) payloads.push(JSON.stringify(keys));
  return payloads;
}
