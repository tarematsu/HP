const D1_PAYLOAD_MAX_BYTES = 1_500_000;
const D1_PAYLOAD_MAX_ITEMS = 1000;

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function makePayloadChunks(items) {
  const chunks = [];
  let current = [];
  let currentBytes = 2;

  for (const item of items) {
    const serialized = JSON.stringify(item);
    const itemBytes = byteLength(serialized) + (current.length ? 1 : 0);
    if (
      current.length
      && (current.length >= D1_PAYLOAD_MAX_ITEMS || currentBytes + itemBytes > D1_PAYLOAD_MAX_BYTES)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
