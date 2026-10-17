#!/usr/bin/env node
// Read-only R2 collection freshness diagnostics. Missing evidence is never healthy.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from '../../worker/scripts/remote-r2-json-adapter.mjs';
import { regionalSnapshotKey } from '../../worker/src/regional-music-r2-snapshot.js';

export function assessSnapshot(service, snapshot, now = Date.now(), maxAgeHours = 48) {
  const stamp = snapshot?.updated_at ?? snapshot?.generated_at ?? snapshot?.collected_at;
  const time = typeof stamp === 'number' ? stamp : Date.parse(stamp || '');
  const count = Array.isArray(snapshot?.tracks) ? snapshot.tracks.length : null;
  if (!Number.isFinite(time)) return { service, status: 'UNKNOWN', detail: 'source timestamp missing' };
  const ageHours = (now - time) / 3600000;
  if (ageHours < -1) return { service, status: 'FAIL', detail: 'future source timestamp' };
  if (ageHours > maxAgeHours) return { service, status: 'STALE', detail: `source age ${ageHours.toFixed(1)}h > ${maxAgeHours}h` };
  if (count === 0) return { service, status: 'FAIL', detail: 'empty tracks' };
  return { service, status: 'OK', detail: `source age ${ageHours.toFixed(1)}h; tracks=${count ?? 'not supplied'}` };
}

export async function auditR2(r2, now = Date.now()) {
  const results = [];
  for (const service of ['qq_music', 'kugou_music']) {
    try {
      const object = await r2.get(regionalSnapshotKey(service));
      results.push(object ? assessSnapshot(service, await object.json(), now) : { service, status: 'UNKNOWN', detail: 'object missing' });
    } catch (error) {
      results.push({ service, status: 'UNKNOWN', detail: `read failed: ${String(error?.message || error).slice(0, 100)}` });
    }
  }
  return results;
}

export function renderR2Audit(rows) {
  return '## R2 collection freshness (regional canonical snapshots)\n\n| Service | State | Evidence |\n|---|---|---|\n' +
    rows.map(row => `| ${row.service} | ${row.status} | ${row.detail.replaceAll('|', '/')} |`).join('\n') + '\n';
}

async function main() {
  const config = JSON.parse(await readFile(new URL('../../worker/wrangler.regional-music.jsonc', import.meta.url), 'utf8'));
  const bucket = config.r2_buckets.find(row => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  if (!bucket) throw new Error('PAGES_RESPONSE_R2 bucket is not configured');
  const r2 = createWranglerRemoteR2({ bucket, cwd: new URL('../../worker/', import.meta.url).pathname });
  const rows = await auditR2(r2);
  const summary = renderR2Audit(rows);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);
  if (rows.some(row => row.status !== 'OK')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
