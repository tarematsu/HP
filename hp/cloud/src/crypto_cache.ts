const keyCache = new Map<string, Promise<CryptoKey>>();
const utf8Encoder = new TextEncoder();

export function cachedHmacKey(secret: string): Promise<CryptoKey> {
  let promise = keyCache.get(secret);
  if (!promise) {
    promise = crypto.subtle.importKey(
      "raw",
      utf8Encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ).catch(error => {
      keyCache.delete(secret);
      throw error;
    });
    keyCache.set(secret, promise);
  }
  return promise;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = utf8Encoder.encode(left);
  const b = utf8Encoder.encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = index < a.length ? a[index]! : 0;
    const rightByte = index < b.length ? b[index]! : 0;
    diff |= leftByte ^ rightByte;
  }
  return diff === 0;
}
