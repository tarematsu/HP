import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { enqueueGeniePublication } from './collect-genie-r2-actions.mjs';
import { collectLatestKugouAcgHistory } from '../src/kugou-acg-chart-history.js';

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.regional-music.jsonc'), 'utf8'));
  const bucket = config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!bucket) throw new Error('PAGES_RESPONSE_R2 bucket missing');
  if (!account || !token) throw new Error('Cloudflare account context missing');

  const r2 = createWranglerRemoteR2({
    bucket,
    cwd:root,
    wranglerScript:join(root, 'node_modules/wrangler/bin/wrangler.js'),
  });
  const load = async (key) => {
    const object = await r2.get(key);
    return object ? object.json() : null;
  };
  const save = async (key, value) => {
    await r2.put(key, JSON.stringify(value));
    console.log(JSON.stringify({ event:'kugou_acg_saved', key, entries:value.entries?.length ?? value.history?.length ?? null }));
  };

  const now = Date.now();
  const result = await collectLatestKugouAcgHistory({ load, save, now });
  if (result.changed) {
    const api = async (path, body) => {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
        method:body ? 'POST' : 'GET',
        headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json' },
        ...(body ? { body:JSON.stringify(body) } : {}),
        signal:AbortSignal.timeout(30_000),
      });
      const payload = await response.json();
      if (!response.ok || payload.success !== true) throw new Error(`Publication API failed: HTTP ${response.status}`);
      return payload.result;
    };
    await enqueueGeniePublication(config, api, now);
  }
  console.log(JSON.stringify({ event:'kugou_acg_collect_complete', publication_messages:result.changed ? 1 : 0, ...result }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
