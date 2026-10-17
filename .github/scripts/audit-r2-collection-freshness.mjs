#!/usr/bin/env node
// Read-only source diagnostics: publication time alone is not collection evidence.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from '../../worker/scripts/remote-r2-json-adapter.mjs';
import { regionalSnapshotKey } from '../../worker/src/regional-music-r2-snapshot.js';

// Scheduled sources: daily YouTube, weekly QQ/KKBOX, weekday Kugou.
// Allow one day of scheduling/retry grace, including Kugou's weekend gap.
export const R2_COLLECTION_MAX_AGE_HOURS = Object.freeze({
  youtube_music: 48,
  qq_music: 192,
  kkbox: 192,
  kugou_music: 96,
});

function timestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? (value < 1e11 ? value * 1000 : value) : NaN;
  return typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
}

export function assessSnapshot(service, snapshot, now = Date.now(), maxAgeHours = R2_COLLECTION_MAX_AGE_HOURS[service]) {
  const result = (status, detail) => ({ service, status, detail });
  if (snapshot?.version !== 1 || snapshot?.service !== service || snapshot?.state?.service !== service) {
    return result('UNKNOWN', 'snapshot schema or service identity mismatch');
  }
  const state = snapshot.state.status;
  if (!state) return result('UNKNOWN', 'collector status missing');
  if (state !== 'ok') return result('FAIL', `collector state=${String(state).replace(/[^a-z_-]/gi, '').slice(0, 40)}`);
  const time = timestamp(snapshot.updated_at);
  const successTime = timestamp(snapshot.state.last_success_at);
  if (!Number.isFinite(successTime)) return result('UNKNOWN', 'last_success_at missing or invalid');
  if (!Number.isFinite(time)) return result('UNKNOWN', 'snapshot timestamp missing or invalid');
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return result('UNKNOWN', 'invalid audit time or cadence');
  if (time > now + 3600000 || successTime > now + 3600000) return result('FAIL', 'future source or snapshot timestamp');
  if (successTime > time + 3600000) return result('FAIL', 'source success is newer than snapshot');
  const ageHours = (now - successTime) / 3600000;
  const evidence = `last success ${new Date(successTime).toISOString()}; source age ${ageHours.toFixed(1)}h; limit ${maxAgeHours}h`;
  if (ageHours > maxAgeHours || (now - time) / 3600000 > maxAgeHours) return result('STALE', evidence);
  if (!Array.isArray(snapshot.tracks)) return result('UNKNOWN', 'tracks missing');
  if (!snapshot.tracks.length) return result('FAIL', 'empty tracks');
  if (snapshot.tracks.some(row => row?.service !== service)) return result('FAIL', 'track service identity mismatch');
  return result('OK', `${evidence}; tracks=${snapshot.tracks.length}`);
}

export async function auditR2(r2, now = Date.now()) {
  const results = [];
  for (const service of Object.keys(R2_COLLECTION_MAX_AGE_HOURS)) {
    try {
      const object = await r2.get(regionalSnapshotKey(service));
      results.push(object ? assessSnapshot(service, await object.json(), now) : { service, status: 'UNKNOWN', detail: 'object missing' });
    } catch {
      // Provider/CLI errors may contain credentials. Do not copy them to reports.
      results.push({ service, status: 'UNKNOWN', detail: 'R2 read or JSON decode failed' });
    }
  }
  return results;
}

export function renderR2Audit(rows) {
  const cell = value => String(value).replace(/[|\r\n<>]/g, ' ');
  return '## R2 collection freshness (regional canonical snapshots)\n\n' +
    'Scope: YouTube Music, QQ Music, KKBOX, Kugou canonical source snapshots; this does not certify other collectors or individual chart/catalog lanes. Missing evidence fails the gate.\n\n' +
    '| Service | State | Evidence |\n|---|---|---|\n' +
    rows.map(row => `| ${cell(row.service)} | ${cell(row.status)} | ${cell(row.detail)} |`).join('\n') + '\n';
}

async function main() {
  const config = JSON.parse(await readFile(new URL('../../worker/wrangler.regional-music.jsonc', import.meta.url), 'utf8'));
  const bucket = config.r2_buckets.find(row => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  if (!bucket) throw new Error('PAGES_RESPONSE_R2 bucket is not configured');
  const cwd = fileURLToPath(new URL('../../worker/', import.meta.url));
  const wranglerScript = fileURLToPath(new URL('../../worker/node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const rows = await auditR2(createWranglerRemoteR2({ bucket, cwd, wranglerScript }));
  const summary = renderR2Audit(rows);
  await writeFile('r2-collection-summary.md', summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);
  if (rows.some(row => row.status !== 'OK')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('R2 collection audit could not complete'); process.exitCode = 1; });
