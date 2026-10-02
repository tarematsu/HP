import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REGIONAL_MUSIC_DAILY_SERVICES } from '../src/regional-music-dispatch-plan.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { bootstrapProducerReadModel } from './bootstrap-producer-read-model.mjs';

export async function dispatchRegionalRecollection({ config, api, now = Date.now() }) {
  const queueName = config.queues?.consumers?.[0]?.queue;
  if (!queueName) throw new Error('Regional queue configuration is missing');
  const queues = await api('/queues');
  const queue = queues.find((row) => row.queue_name === queueName);
  if (!queue?.queue_id) throw new Error('Configured regional queue was not found');
  for (const service of REGIONAL_MUSIC_DAILY_SERVICES) {
    await api(`/queues/${queue.queue_id}/messages`, {
      body: { message_type: 'regional-music-collect', service, scheduled_at: now },
      content_type: 'json',
    });
  }
  return { scheduled_at: now, services: [...REGIONAL_MUSIC_DAILY_SERVICES] };
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.regional-music.jsonc'), 'utf8'));
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Cloudflare account context is missing');
  const api = async (path, body) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    if (!response.ok || result.success !== true) throw new Error(`Queue API failed: HTTP ${response.status}; codes ${(result.errors || []).map((e) => e.code).join(',')}`);
    return result.result;
  };
  const run = await dispatchRegionalRecollection({ config, api });
  console.log(JSON.stringify({ event: 'regional_manual_dispatched', ...run }));
  const database = config.d1_databases.find((row) => row.binding === 'OTHER_DB')?.database_name;
  const db = createWranglerRemoteD1({ database, cwd: root, wranglerScript: join(root, 'node_modules/wrangler/bin/wrangler.js') });
  const deadline = Date.now() + 25 * 60_000;
  while (Date.now() < deadline) {
    const result = await db.prepare('SELECT service,status,last_attempt_at,last_success_at,last_error_class,last_error_message,entity_counts_json FROM regional_music_collector_state WHERE last_attempt_at>=?').bind(run.scheduled_at).all();
    const rows = (result.results || []).filter((row) => run.services.includes(row.service));
    console.log(JSON.stringify({ event: 'regional_manual_progress', completed: rows.length, total: run.services.length }));
    if (rows.length === run.services.length) {
      console.log(JSON.stringify({ event: 'regional_manual_results', results: rows }));
      console.log(JSON.stringify({ event: 'regional_manual_published', ...await bootstrapProducerReadModel('wrangler.regional-music.jsonc') }));
      return;
    }
    await new Promise((done) => setTimeout(done, 30_000));
  }
  throw new Error('Regional collection did not finish within 25 minutes');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  console.error('Regional collection moved to R2. Run: node scripts/collect-regional-r2-actions.mjs --all');
  process.exitCode = 1;
}
