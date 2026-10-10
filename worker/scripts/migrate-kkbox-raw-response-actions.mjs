import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

export async function migrateKkboxRawResponse(r2) {
  const modelKey = 'music-service:kkbox';
  const key = pagesR2ResponseKey(modelKey);
  // Existing canonical publications take precedence over historical snapshots.
  if (await r2.get(key)) return { migrated: false, reason: 'canonical-exists' };
  const legacyKey = `pages-response/actions-v2/${Buffer.from(modelKey).toString('hex')}.json`;
  const object = await r2.get(legacyKey);
  if (!object) throw new Error('Legacy KKBOX response unavailable');
  const envelope = await object.json();
  if (Number(envelope?.version) !== 1 || typeof envelope.body !== 'string'
      || !Number.isFinite(Number(envelope.updated_at))) throw new Error('Invalid legacy KKBOX envelope');
  const bodyKey = `pages-response/raw-body-v1/${createHash('sha256').update(envelope.body).digest('hex')}.json`;
  // Publish the immutable body first, then its small manifest. Preserve the
  // original freshness timestamp, headers and status; retain the legacy copy.
  await r2.put(bodyKey, envelope.body);
  const raw = await r2.get(bodyKey);
  if (!raw || await raw.text() !== envelope.body) throw new Error('Raw KKBOX body verification failed');
  // Recheck before publishing to avoid replacing a newer producer snapshot.
  if (await r2.get(key)) return { migrated: false, reason: 'canonical-published-concurrently' };
  await r2.put(key, JSON.stringify({
    ...envelope, body: undefined, format: 'raw-response-reference-v1', body_key: bodyKey,
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
  console.log(JSON.stringify({ event: 'kkbox_raw_response_migration', ...await migrateKkboxRawResponse(r2) }));
}
