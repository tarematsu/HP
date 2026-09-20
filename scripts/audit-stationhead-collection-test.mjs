import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function parseArgs(argv) {
  const options = {
    baseUrl: 'https://skrzk.pages.dev',
    outPath: '.pages-production-audit/stationhead-collection-test.json',
    attempts: 25,
    retryDelayMs: 15_000,
    expectedHandle: 'sakuramankai',
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
    ok: response.ok && body.includes('Stationhead 5分収集テスト'),
    title_present: body.includes('<title>Stationhead collection test</title>'),
  };
}

function finished(status) {
  return status === 'completed' || status === 'completed-awaiting-checkpoint';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiUrl = `${options.baseUrl}/api/stationhead-collection-test`;
  const pageUrl = `${options.baseUrl}/stationhead-test/`;
  let payload = null;
  let lastError = null;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      payload = await requestJson(apiUrl);
      const summary = {
        attempt,
        status: payload.test?.status || null,
        handle: payload.test?.handle || null,
        samples: payload.sample_count ?? null,
        chats: payload.chat_sample_count ?? null,
      };
      console.log(JSON.stringify({ event: 'stationhead_collection_test_probe', ...summary }));
      if (payload.test && finished(payload.test.status)) break;
    } catch (error) {
      lastError = error;
      console.error(JSON.stringify({
        event: 'stationhead_collection_test_probe_failed',
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

  if (!payload?.test) throw lastError || new Error('collection test state was not found');
  if (payload.test.handle !== options.expectedHandle) {
    throw new Error(`unexpected collection test handle: ${payload.test.handle}`);
  }
  if (!finished(payload.test.status)) throw new Error(`collection test did not finish: ${payload.test.status}`);
  if (Number(payload.test.duration_ms) !== 300_000) {
    throw new Error(`unexpected collection test duration: ${payload.test.duration_ms}`);
  }
  if (!Number.isInteger(payload.sample_count) || payload.sample_count < 1) {
    throw new Error(`collection test produced no main samples: ${payload.sample_count}`);
  }
  if ((payload.samples || []).some((sample) => sample.raw_valid !== 1)) {
    throw new Error('collection test contains invalid raw main JSON');
  }
  if (!page.ok) throw new Error(`confirmation page validation failed: HTTP ${page.status}`);
  console.log(JSON.stringify({
    event: 'stationhead_collection_test_audit_ok',
    handle: payload.test.handle,
    started_at: payload.test.started_at,
    ends_at: payload.test.ends_at,
    sample_count: payload.sample_count,
    chat_sample_count: payload.chat_sample_count,
    page_status: page.status,
  }));
}

await main();
