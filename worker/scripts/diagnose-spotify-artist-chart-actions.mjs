import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPOTIFY_ARTIST_CHART_CRON } from '../src/scheduled-crons.js';
import { SPOTIFY_JP_CHARTS } from '../../packages/sh-shared/spotify-charts.mjs';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Cloudflare account context missing');
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, '../wrangler.spotify-playcount.jsonc'), 'utf8'));
const queueName = config.queues.producers.find(row => row.binding === 'SPOTIFY_PLAYCOUNT_QUEUE')?.queue;
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
async function api(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(`Cloudflare Queue diagnostic request failed: HTTP ${response.status}`);
  return data.result;
}
const queues = await api('/queues');
const queue = queues.find(row => row.queue_name === queueName);
if (!queue?.queue_id) throw new Error('Spotify Queue unavailable');
// Manual recovery also queues the five supported chart series.
for (const spec of SPOTIFY_JP_CHARTS) {
  await api(`/queues/${queue.queue_id}/messages`, {
    body: { message_type: 'spotify-japan-chart-work', message_version: 1,
      chart_id: spec.id, mode: 'latest', day: new Date().toISOString().slice(0, 10) },
    content_type: 'json',
  });
}
await api(`/queues/${queue.queue_id}/messages`, {
  body: { message_type: 'spotify-scheduled-dispatch', message_version: 1,
    cron: SPOTIFY_ARTIST_CHART_CRON, scheduled_time: Date.now() },
  content_type: 'json',
});
console.log('Queued all five supported Japan Charts and an independent legacy artist-chart retry.');
