import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import {
  KUGOU_ACG_BACKFILL_BATCH_SIZE,
  KUGOU_ACG_BACKFILL_DEFAULT_START,
} from '../src/kugou-acg-backfill.js';
import { KUGOU_ACG_HISTORY_PROGRESS_KEY } from '../src/kugou-acg-chart-history.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { KUGOU_ACG_BACKFILL_MESSAGE_TYPE } from '../src/regional-music-service-entry.js';

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 45 * 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cloudflareApi(account, token, path, body = undefined) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new Error(`Cloudflare API failed: HTTP ${response.status}`);
  }
  return payload.result;
}

async function readJson(r2, key) {
  const object = await r2.get(key);
  return object ? object.json() : null;
}

async function waitForCompletion(r2, requestedAt, startDate) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let previousSignature = '';
  while (Date.now() < deadline) {
    const progress = await readJson(r2, KUGOU_ACG_HISTORY_PROGRESS_KEY);
    const fresh = Number(progress?.updated_at || 0) >= requestedAt;
    const matchingStart = String(progress?.start_date || '') === startDate;
    if (fresh && matchingStart) {
      const signature = JSON.stringify({
        status: progress.status,
        stored_periods: progress.stored_periods,
        history_entries: progress.history_entries,
        remaining: progress.remaining,
      });
      if (signature !== previousSignature) {
        console.log(JSON.stringify({ event: 'kugou_acg_backfill_progress', ...progress }));
        previousSignature = signature;
      }
      if (progress.complete === true && progress.status === 'complete') return progress;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Kugou ACG backfill did not complete before workflow timeout');
}

async function waitForPagesReadModel(r2, progress) {
  const key = pagesActionsR2ResponseKey('regional-music:kugou_music');
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const envelope = await readJson(r2, key);
    try {
      const payload = envelope?.body ? JSON.parse(envelope.body) : null;
      const chart = payload?.kugou_acg_chart;
      const periodCount = Array.isArray(chart?.periods) ? chart.periods.length : 0;
      if (periodCount >= Number(progress?.stored_periods || 0)) {
        return {
          updated_at: payload.updated_at,
          source_updated_at: payload.source_updated_at,
          periods: periodCount,
          history_entries: Array.isArray(chart?.history) ? chart.history.length : 0,
        };
      }
    } catch {}
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Kugou ACG Pages read model was not materialized after backfill');
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.regional-music.jsonc'), 'utf8'));
  const bucket = config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  const queueName = config.queues?.consumers?.[0]?.queue;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!bucket) throw new Error('PAGES_RESPONSE_R2 bucket missing');
  if (!queueName) throw new Error('Regional music queue missing');
  if (!account || !token) throw new Error('Cloudflare account context missing');

  const queues = await cloudflareApi(account, token, '/queues');
  const queue = queues.find((row) => row.queue_name === queueName);
  if (!queue?.queue_id) throw new Error('Regional music queue not found');

  const startDate = process.env.KUGOU_ACG_HISTORY_START || KUGOU_ACG_BACKFILL_DEFAULT_START;
  const batchSize = Number(process.env.KUGOU_ACG_HISTORY_BATCH_SIZE) || KUGOU_ACG_BACKFILL_BATCH_SIZE;
  const requestedAt = Date.now();
  await cloudflareApi(account, token, `/queues/${queue.queue_id}/messages`, {
    body: {
      message_type: KUGOU_ACG_BACKFILL_MESSAGE_TYPE,
      message_version: 1,
      start_date: startDate,
      batch_size: batchSize,
      requested_at: requestedAt,
    },
    content_type: 'json',
  });
  console.log(JSON.stringify({
    event: 'kugou_acg_backfill_enqueued',
    queue: queueName,
    start_date: startDate,
    batch_size: batchSize,
    requested_at: requestedAt,
  }));

  const r2 = createWranglerRemoteR2({
    bucket,
    cwd: root,
    wranglerScript: join(root, 'node_modules/wrangler/bin/wrangler.js'),
  });
  const progress = await waitForCompletion(r2, requestedAt, startDate);
  const pages = await waitForPagesReadModel(r2, progress);
  console.log(JSON.stringify({ event: 'kugou_acg_backfill_complete', ...progress, pages }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
