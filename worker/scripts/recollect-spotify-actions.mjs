import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { jstDateKey, readRun, SPOTIFY_TARGET_ARTISTS } from '../src/spotify-playcount-common.js';
import { runSpotifyPlaycountScheduled } from '../src/spotify-playcount-schedule.js';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'wrangler.spotify-playcount.jsonc'), 'utf8'));
const database = config.d1_databases.find(row => row.binding === 'OTHER_DB')?.database_name;
const queueName = config.queues.producers.find(row => row.binding === 'SPOTIFY_PLAYCOUNT_QUEUE')?.queue;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token || !queueName || !database) throw new Error('Spotify collection configuration missing');
const api = async (path, body) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok || result.success !== true) throw new Error(`Spotify queue API failed: HTTP ${response.status}`);
  return result.result;
};
const queues = await api('/queues');
const matches = queues.filter(row => row.queue_name === queueName);
if (matches.length !== 1) throw new Error('Configured Spotify queue was not uniquely resolved');
const db = createWranglerRemoteD1({ database, cwd: root, wranglerScript: join(root, 'node_modules/wrangler/bin/wrangler.js') });
const now = Date.now();
const today = jstDateKey(now);
const report = async () => {
  const run = await readRun(db, today);
  console.log(JSON.stringify({ event: 'spotify_manual_progress', snapshot_date: today, run }));
  return run;
};
await report();
await runSpotifyPlaycountScheduled({ scheduledTime: now }, {
  ...config.vars,
  OTHER_DB: db,
  SPOTIFY_PLAYCOUNT_QUEUE: {
    send: body => api(`/queues/${matches[0].queue_id}/messages`, { body, content_type: 'json' }),
  },
}, { manualSnapshotDate: today });
const deadline = Date.now() + 40 * 60_000;
while (Date.now() < deadline) {
  const run = await report();
  if (run?.status === 'complete') {
    const { results } = await db.prepare('SELECT artist_key,track_count FROM sh_spotify_artist_daily WHERE snapshot_date=?').bind(today).all();
    const missing = SPOTIFY_TARGET_ARTISTS.filter(artist => !results.some(row => row.artist_key === artist.artist_key && Number(row.track_count) > 0));
    if (missing.length) throw new Error('Completed Spotify snapshot is missing target artist data');
    console.log(JSON.stringify({ event: 'spotify_manual_complete', snapshot_date: today, artists: results }));
    break;
  }
  if (['error', 'incomplete', 'stale'].includes(run?.status)) throw new Error(`Spotify collection stopped: ${run.status}; ${run.last_error || ''}`);
  await new Promise(resolve => setTimeout(resolve, 30_000));
}
if ((await readRun(db, today))?.status !== 'complete') throw new Error('Timed out waiting for today’s Spotify collection');
