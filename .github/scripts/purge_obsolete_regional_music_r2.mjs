import { readFileSync } from 'node:fs';

const REMOVED = Object.freeze([
  'bugs','joox','nhaccuatui','anghami','melon','netease_cloud_music','naver_vibe','flo',
  'yandex_music','boomplay','plern','fungjai','zing_mp3','jiosaavn','gaana','langit_musik',
]);
const ACTIVE = Object.freeze(['youtube_music','genie','kkbox','qq_music','kugou_music']);
if (REMOVED.some((service) => ACTIVE.includes(service))) throw new Error('active service present in removal list');

const config = JSON.parse(readFileSync(new URL('../../worker/wrangler.regional-music.jsonc', import.meta.url), 'utf8'));
const bucket = config.r2_buckets?.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!bucket || !account || !token) throw new Error('Cloudflare R2 context missing');

const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${encodeURIComponent(bucket)}`;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload?.success === false) {
    throw new Error(`Cloudflare R2 API failed: ${response.status} ${JSON.stringify(payload?.errors || [])}`);
  }
  return payload || { success: true, result: null };
}

async function listPrefix(prefix) {
  const keys = [];
  let cursor = '';
  for (;;) {
    const params = new URLSearchParams({ prefix, per_page: '1000' });
    if (cursor) params.set('cursor', cursor);
    const payload = await api(`${base}/objects?${params}`);
    const rows = Array.isArray(payload.result) ? payload.result : [];
    for (const row of rows) if (row?.key) keys.push(String(row.key));
    const info = payload.result_info || {};
    const next = String(info.cursor || '');
    if (!info.is_truncated || !next || next === cursor) break;
    cursor = next;
  }
  return keys.sort();
}

function encodedObjectKey(key) {
  return String(key).split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function deleteKey(key) {
  const response = await fetch(`${base}/objects/${encodedObjectKey(key)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return false;
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload?.success === false) {
    throw new Error(`Cloudflare R2 delete failed for ${key}: ${response.status}`);
  }
  return true;
}

function actionsKey(modelKey) {
  const bytes = new TextEncoder().encode(modelKey);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `pages-response/actions-v2/${hex}.json`;
}

function legacyKey(modelKey) {
  return `pages-response/v1/${encodeURIComponent(modelKey)}.json`;
}

const activeBefore = Object.fromEntries(await Promise.all(ACTIVE.map(async (service) => [service, await listPrefix(`regional-music/${service}/`)])));
const removedSummary = {};

for (const service of REMOVED) {
  const prefixKeys = await listPrefix(`regional-music/${service}/`);
  const exactKeys = [legacyKey(`regional-music:${service}`), actionsKey(`regional-music:${service}`)];
  let deleted = 0;
  for (const key of [...new Set([...prefixKeys, ...exactKeys])]) {
    if (await deleteKey(key)) deleted += 1;
  }
  const remaining = await listPrefix(`regional-music/${service}/`);
  if (remaining.length) throw new Error(`R2 prefix still contains retired objects: ${service}`);
  removedSummary[service] = { prefix_objects: prefixKeys.length, deleted };
}

const activeAfter = Object.fromEntries(await Promise.all(ACTIVE.map(async (service) => [service, await listPrefix(`regional-music/${service}/`)])));
for (const service of ACTIVE) {
  if (JSON.stringify(activeBefore[service]) !== JSON.stringify(activeAfter[service])) {
    throw new Error(`active R2 prefix changed during cleanup: ${service}`);
  }
}

console.log(JSON.stringify({
  event: 'obsolete_regional_music_r2_purged',
  removed: removedSummary,
  active_prefix_counts: Object.fromEntries(ACTIVE.map((service) => [service, activeAfter[service].length])),
}, null, 2));
