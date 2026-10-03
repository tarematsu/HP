import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REMOVED = Object.freeze([
  'genie','bugs','joox','nhaccuatui','anghami','melon','netease_cloud_music','naver_vibe','flo',
  'yandex_music','boomplay','plern','fungjai','zing_mp3','jiosaavn','gaana','langit_musik',
]);
const ACTIVE = Object.freeze(['youtube_music','kkbox','qq_music','kugou_music']);
if (REMOVED.some((service) => ACTIVE.includes(service))) throw new Error('active service present in removal list');

const root = resolve(import.meta.dirname, '../..');
const workerRoot = resolve(root, 'worker');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const config = JSON.parse(readFileSync(resolve(workerRoot, 'wrangler.regional-music.jsonc'), 'utf8'));
const bucket = config.r2_buckets?.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!bucket || !account || !token) throw new Error('Cloudflare R2 context missing');

const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${encodeURIComponent(bucket)}`;

async function api(url) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    throw new Error(`Cloudflare R2 list failed: ${response.status} ${JSON.stringify(payload?.errors || [])}`);
  }
  return payload;
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

function deleteKey(key) {
  try {
    execFileSync(process.execPath, [
      wranglerScript,
      'r2', 'object', 'delete', `${bucket}/${key}`,
      '--remote',
    ], {
      cwd: workerRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      env: process.env,
    });
    return true;
  } catch (error) {
    const output = `${error?.stdout || ''}\n${error?.stderr || ''}`;
    if (/does not exist|not found|NoSuchKey|404/i.test(output)) return false;
    throw new Error(`Wrangler R2 delete failed for ${key}: ${output.slice(0, 800)}`);
  }
}

function actionsKey(modelKey) {
  const bytes = new TextEncoder().encode(modelKey);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `pages-response/actions-v2/${hex}.json`;
}

function legacyKey(modelKey) {
  return `pages-response/v1/${encodeURIComponent(modelKey)}.json`;
}

const activeBefore = Object.fromEntries(await Promise.all(
  ACTIVE.map(async (service) => [service, await listPrefix(`regional-music/${service}/`)]),
));
const removedSummary = {};

for (const service of REMOVED) {
  const prefixKeys = await listPrefix(`regional-music/${service}/`);
  const exactKeys = [legacyKey(`regional-music:${service}`), actionsKey(`regional-music:${service}`)];
  let deleted = 0;
  for (const key of [...new Set([...prefixKeys, ...exactKeys])]) {
    if (deleteKey(key)) deleted += 1;
  }
  const remaining = await listPrefix(`regional-music/${service}/`);
  if (remaining.length) throw new Error(`R2 prefix still contains retired objects: ${service}`);
  removedSummary[service] = { prefix_objects: prefixKeys.length, deleted };
}

const activeAfter = Object.fromEntries(await Promise.all(
  ACTIVE.map(async (service) => [service, await listPrefix(`regional-music/${service}/`)]),
));
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
