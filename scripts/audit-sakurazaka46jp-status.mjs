import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function parseArgs(argv) {
  const options = {
    baseUrl: 'https://skrzk.pages.dev',
    outPath: '.pages-production-audit/sakurazaka46jp-status.json',
    attempts: 8,
    retryDelayMs: 15_000,
    expectedHandle: 'sakurazaka46jp',
  };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) options.baseUrl = arg.slice('--url='.length).replace(/\/+$/, '');
    else if (arg.startsWith('--out=')) options.outPath = arg.slice('--out='.length);
    else if (arg.startsWith('--attempts=')) options.attempts = Number(arg.slice('--attempts='.length));
    else if (arg.startsWith('--retry-delay-ms=')) options.retryDelayMs = Number(arg.slice('--retry-delay-ms='.length));
    else if (arg.startsWith('--expected-handle=')) options.expectedHandle = arg.slice('--expected-handle='.length).trim().toLowerCase();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^https:\/\//.test(options.baseUrl)) throw new Error('--url must use HTTPS');
  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 40) {
    throw new Error('--attempts must be an integer between 1 and 40');
  }
  if (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0 || options.retryDelayMs > 60_000) {
    throw new Error('--retry-delay-ms must be between 0 and 60000');
  }
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  if (!payload || payload.ok !== true) throw new Error(`${url} returned invalid payload: ${text.slice(0, 500)}`);
  return payload;
}

async function pageStatus(url) {
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  const body = await response.text();
  return {
    status: response.status,
    ok: response.ok && body.includes('<h1>sakurazaka46jp</h1>'),
    title_present: body.includes('<title>sakurazaka46jp Stationhead status</title>'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiUrl = `${options.baseUrl}/api/sakurazaka46jp-status`;
  const pageUrl = `${options.baseUrl}/sakurazaka46jp/`;
  let payload = null;
  let lastError = null;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      payload = await requestJson(apiUrl);
      console.log(JSON.stringify({
        event: 'sakurazaka46jp_status_probe',
        attempt,
        handle: payload.handle || null,
        latest_main: payload.latest_main?.observed_at || null,
        latest_chat: payload.latest_chat?.observed_at || null,
        samples: payload.sample_count ?? null,
        chats: payload.chat_sample_count ?? null,
      }));
      if (payload.handle === options.expectedHandle && payload.latest_main) break;
    } catch (error) {
      lastError = error;
      console.error(JSON.stringify({
        event: 'sakurazaka46jp_status_probe_failed',
        attempt,
        error: String(error?.message || error).slice(0, 800),
      }));
    }
    if (attempt < options.attempts) await sleep(options.retryDelayMs);
  }

  const page = await pageStatus(pageUrl);
  const report = {
    checked_at: Date.now(),
    base_url: options.baseUrl,
    page,
    payload,
  };
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (!payload) throw lastError || new Error('Sakurazaka collection status was not found');
  if (payload.handle !== options.expectedHandle) throw new Error(`unexpected handle: ${payload.handle}`);
  if (!payload.latest_main) throw new Error('latest main collection sample was not found');
  if (!Number.isInteger(payload.sample_count) || payload.sample_count < 1) {
    throw new Error(`status endpoint returned no main samples: ${payload.sample_count}`);
  }
  if ((payload.samples || []).some((sample) => sample.raw_valid !== 1)) {
    throw new Error('recent Sakurazaka main samples contain invalid raw JSON');
  }
  if ((payload.chats || []).some((sample) => sample.raw_valid !== 1)) {
    throw new Error('recent Sakurazaka chat samples contain invalid raw JSON');
  }
  if (!page.ok || !page.title_present) {
    throw new Error(`confirmation page validation failed: HTTP ${page.status}`);
  }
  console.log(JSON.stringify({
    event: 'sakurazaka46jp_status_audit_ok',
    handle: payload.handle,
    latest_main: payload.latest_main.observed_at,
    latest_chat: payload.latest_chat?.observed_at || null,
    sample_count: payload.sample_count,
    chat_sample_count: payload.chat_sample_count,
    page_status: page.status,
  }));
}

await main();
