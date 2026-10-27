#!/usr/bin/env node
// Read-only source diagnostics: publication time alone is not collection evidence.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from '../../worker/scripts/remote-r2-json-adapter.mjs';
import { regionalSnapshotKey } from '../../worker/src/regional-music-r2-snapshot.js';
import { REGIONAL_MUSIC_SERVICES } from '../../worker/src/regional-music-service-registry.js';
import { createWranglerRemoteD1 } from '../../worker/scripts/remote-d1-adapter.mjs';
import { auditSpotifyCharts, auditSpotifyD1 } from './audit-spotify-collection.mjs';

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
  if (state !== 'ok') {
    const detail = [
      `collector state=${String(state).replace(/[^a-z_-]/gi, '').slice(0, 40)}`,
    ];
    const safeText = value => String(value ?? '')
      .replace(/\\bBearer\\s+[^\\s,;"'}]+/gi, 'Bearer [redacted]')
      .replace(/(["']?(?:authorization|token|api[_-]?key|secret|password)["']?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^,\\s}]+)/gi, '$1[redacted]')
      .replace(/[\\r\\n|<>]+/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const errorClass = safeText(snapshot.state.last_error_class).slice(0, 100);
    const errorMessage = safeText(snapshot.state.last_error_message).slice(0, 400);
    if (errorClass) detail.push(`class=${errorClass}`);
    if (errorMessage) detail.push(`error=${errorMessage}`);
    const counts = snapshot.state.entity_counts;
    if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
      const countSummary = ['artists', 'tracks', 'releases', 'playlists', 'memberships', 'failures']
        .filter(key => Number.isFinite(Number(counts[key])))
        .map(key => `${key}=${Number(counts[key])}`);
      if (countSummary.length) detail.push(`counts ${countSummary.join(', ')}`);
    }
    return result('FAIL', detail.join('; '));
  }
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
  return '## Persisted collection diagnostics\n\n' +
    'Scope: all 4 active regional canonical snapshots; Spotify 5 Japan charts, 16 editorial playlists, playcount collection runs and each configured monthly-listener artist. Retired regional services are excluded. Regional chart/catalog sub-lanes and unrelated collectors are not certified by a service-level snapshot. Missing evidence fails the gate.\n\n' +
    'Spotify latest collection and historical backfill progress are reported separately. Zero matching artists is valid; missing source evidence is not. All timestamps are UTC.\n\n' +
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
  if (Object.keys(REGIONAL_MUSIC_SERVICES).some(service => !Object.hasOwn(R2_COLLECTION_MAX_AGE_HOURS, service))) {
    rows.push({ service: 'regional/coverage', status: 'UNKNOWN', detail: 'active service has no freshness policy' });
  }
  const spotifyConfig = JSON.parse(await readFile(new URL('../../worker/wrangler.spotify-playcount.jsonc', import.meta.url), 'utf8'));
  const spotifyBucket = spotifyConfig.r2_buckets.find(row => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  const database = spotifyConfig.d1_databases.find(row => row.binding === 'OTHER_DB')?.database_name;
  if (!spotifyBucket || !database) throw new Error('Spotify source storage is not configured');
  const now = Date.now();
  rows.push(...await auditSpotifyCharts(createWranglerRemoteR2({ bucket: spotifyBucket, cwd, wranglerScript }), now));
  rows.push(...await auditSpotifyD1(createWranglerRemoteD1({ database, cwd, wranglerScript }), now));
  const summary = renderR2Audit(rows);
  await writeFile('r2-collection-summary.md', summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);
  if (rows.some(row => row.status !== 'OK')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('R2 collection audit could not complete'); process.exitCode = 1; });
