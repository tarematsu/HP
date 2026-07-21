const databaseInitializers = new WeakMap();

// These schemas are created by versioned D1 migrations before the Worker is
// deployed. Skipping their legacy runtime initializers avoids repeated DDL
// reads/writes whenever Cloudflare starts a new isolate.
const MIGRATED_INITIALIZERS = new Set([
  'collection-capture-schema-v1',
  'collection-timing-schema-v2',
  'd1-compaction-v1',
  'video-blocklist-schema',
  'video-death-list-schema-v2',
  'video-liveness-state-schema-v2'
]);

export function ensureDatabaseOnce(db, key, initializer) {
  if (MIGRATED_INITIALIZERS.has(key)) return undefined;

  if (!db || (typeof db !== 'object' && typeof db !== 'function')) {
    return Promise.resolve().then(initializer);
  }

  let cache = databaseInitializers.get(db);
  if (!cache) {
    cache = new Map();
    databaseInitializers.set(db, cache);
  }

  const existing = cache.get(key);
  if (existing) return existing;

  const pending = Promise.resolve()
    .then(initializer)
    .catch((error) => {
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    });
  cache.set(key, pending);
  return pending;
}