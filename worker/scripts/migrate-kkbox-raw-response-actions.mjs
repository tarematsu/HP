import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { pagesR2ResponseKey, pagesR2RawFallbackKey } from '../src/pages-response-r2.js';

export async function migrateKkboxRawResponse(r2, modelKey = 'music-service:kkbox') {
  const canonicalKey = pagesR2ResponseKey(modelKey);
  let key = canonicalKey;
  let sourceCanonicalMd5 = null;
  let canonicalObject = await r2.get(key);
  let canonical = canonicalObject ? await canonicalObject.json() : null;
  if (canonical?.format === 'raw-response-reference-v1') {
    return { migrated: false, reason: 'already-streaming' };
  }
  if (canonical && !(Number(canonical.version) === 1 && typeof canonical.body === 'string')) {
    // Native raw objects may be stale, but their metadata is unavailable to
    // Wrangler. Preserve them and publish a separate legacy fallback manifest.
    sourceCanonicalMd5 = createHash('md5').update(await canonicalObject.text()).digest('hex');
    key = pagesR2RawFallbackKey(modelKey);
    canonicalObject = await r2.get(key);
    canonical = canonicalObject ? await canonicalObject.json() : null;
    if (canonical?.format === 'raw-response-reference-v1') {
      if (canonical.source_canonical_md5 !== sourceCanonicalMd5) {
        await r2.put(key, JSON.stringify({ ...canonical, body: undefined,
          source_canonical_md5: sourceCanonicalMd5 }));
        if ((await (await r2.get(key))?.json())?.source_canonical_md5 !== sourceCanonicalMd5) {
          throw new Error('Raw fallback checksum verification failed');
        }
        return { migrated: true, metadata_updated: true, updated_at: canonical.updated_at };
      }
      return { migrated: false, reason: 'already-streaming' };
    }
  }
  const legacyKey = `pages-response/actions-v2/${Buffer.from(modelKey).toString('hex')}.json`;
  const object = await r2.get(legacyKey);
  if (!object && !canonical) throw new Error(`Legacy response unavailable: ${modelKey}`);
  const legacy = object ? await object.json() : null;
  const envelope = canonical && Number(canonical.updated_at) >= Number(legacy?.updated_at || 0)
    ? canonical : legacy;
  if (Number(envelope?.version) !== 1 || typeof envelope.body !== 'string'
      || !Number.isFinite(Number(envelope.updated_at))) throw new Error('Invalid legacy KKBOX envelope');
  const bodyKey = `pages-response/raw-body-v1/${createHash('sha256').update(envelope.body).digest('hex')}.json`;
  // Publish the immutable body first, then its small manifest. Preserve the
  // original freshness timestamp, headers and status; retain the legacy copy.
  await r2.put(bodyKey, envelope.body);
  const raw = await r2.get(bodyKey);
  if (!raw || await raw.text() !== envelope.body) throw new Error('Raw KKBOX body verification failed');
  // Recheck before publishing to avoid replacing a newer producer snapshot.
  const current = await r2.get(key);
  if (current && await current.text() !== await canonicalObject?.text()) {
    return { migrated: false, reason: 'canonical-published-concurrently' };
  }
  await r2.put(key, JSON.stringify({
    ...envelope, body: undefined, format: 'raw-response-reference-v1', body_key: bodyKey,
    ...(sourceCanonicalMd5 ? { source_canonical_md5: sourceCanonicalMd5 } : {}),
  }));
  const stored = await r2.get(key);
  if ((await stored?.json())?.body_key !== bodyKey) throw new Error('KKBOX manifest verification failed');
  return { migrated: true, bytes: Buffer.byteLength(envelope.body), updated_at: envelope.updated_at };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.runtime.jsonc'), 'utf8'));
  const bucket = config.r2_buckets.find(row => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  const r2 = createWranglerRemoteR2({ bucket, cwd: root,
    wranglerScript: join(root, 'node_modules/wrangler/bin/wrangler.js') });
  for (const modelKey of ['music-service:kkbox', 'apple-music', 'amazon-music']) {
    console.log(JSON.stringify({ event: 'legacy_raw_response_migration', model_key: modelKey, ...await migrateKkboxRawResponse(r2, modelKey) }));
  }
}
