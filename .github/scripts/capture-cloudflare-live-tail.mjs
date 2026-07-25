#!/usr/bin/env node

import assert from 'node:assert/strict';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_TIMER_SECONDS = Math.floor(2_147_483_647 / 1000);
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const worker = process.env.LIVE_TAIL_WORKER?.trim();

export function parseDurationSeconds(value, fallback = 180) {
  const raw = String(value ?? '').trim();
  const seconds = raw ? Number(raw) : fallback;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('LIVE_TAIL_SECONDS must be a positive finite number');
  }
  if (seconds > MAX_TIMER_SECONDS) {
    throw new Error(`LIVE_TAIL_SECONDS must not exceed ${MAX_TIMER_SECONDS}`);
  }
  return Math.max(10, seconds);
}

export function normalizeProbePath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//')) {
    throw new Error('LIVE_TAIL_PROBES entries must be relative paths');
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

const durationMs = parseDurationSeconds(process.env.LIVE_TAIL_SECONDS) * 1000;
const connectionTimeoutMs = Math.min(30_000, durationMs);
const probes = (process.env.LIVE_TAIL_PROBES || '')
  .split(',')
  .map(normalizeProbePath)
  .filter(Boolean);
const OK_OUTCOMES = new Set(['', 'ok', 'success', 'canceled', 'cancelled']);
const ERROR_OUTCOMES = new Set(['error', 'failed', 'failure', 'exception']);

export function isErrorLike(value) {
  const workers = value?.$workers && typeof value.$workers === 'object' ? value.$workers : {};
  const metadata = value?.$metadata && typeof value.$metadata === 'object' ? value.$metadata : {};
  const source = value?.source && typeof value.source === 'object' ? value.source : {};
  const workerOutcome = String(workers.outcome || '').toLowerCase();
  if (workerOutcome && !OK_OUTCOMES.has(workerOutcome)) return true;
  const level = String(metadata.level || source.level || '').toLowerCase();
  if (level === 'error' || level === 'fatal') return true;
  const sourceOutcome = String(source.outcome || '').toLowerCase();
  return Boolean(metadata.error || source.error || ERROR_OUTCOMES.has(sourceOutcome));
}

export function normalizeWebSocketUrl(value) {
  const url = String(value || '').trim();
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  if (url.startsWith('wss://') || url.startsWith('ws://')) return url;
  throw new Error('Cloudflare live-tail response did not include a valid WebSocket URL');
}

export async function messageDataToText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  if (data && typeof data.text === 'function') return data.text();
  throw new TypeError('Unsupported live-tail WebSocket message payload');
}

export function parseLiveTailMessage(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {
      unparsed: true,
      byteLength: new TextEncoder().encode(text).byteLength,
    };
  }
}

async function selfTest() {
  assert.equal(parseDurationSeconds('', 180), 180);
  assert.equal(parseDurationSeconds('1'), 10);
  assert.equal(parseDurationSeconds('90'), 90);
  assert.equal(parseDurationSeconds(String(MAX_TIMER_SECONDS)), MAX_TIMER_SECONDS);
  assert.throws(() => parseDurationSeconds('not-a-number'), /positive finite number/);
  assert.throws(() => parseDurationSeconds('Infinity'), /positive finite number/);
  assert.throws(() => parseDurationSeconds('0'), /positive finite number/);
  assert.throws(() => parseDurationSeconds(String(MAX_TIMER_SECONDS + 1)), /must not exceed/);
  assert.equal(normalizeProbePath('health'), '/health');
  assert.equal(normalizeProbePath('/health?full=1'), '/health?full=1');
  assert.equal(normalizeProbePath(''), '');
  assert.throws(() => normalizeProbePath('https://example.test/health'), /relative paths/);
  assert.throws(() => normalizeProbePath('//example.test/health'), /relative paths/);
  assert.equal(isErrorLike({ $workers: { outcome: 'ok' } }), false);
  assert.equal(isErrorLike({ source: { outcome: 'success' } }), false);
  assert.equal(isErrorLike({ $workers: { outcome: 'exception' } }), true);
  assert.equal(isErrorLike({ source: { outcome: 'failure' } }), true);
  assert.equal(isErrorLike({ $metadata: { level: 'error' } }), true);
  assert.equal(isErrorLike({ source: { error: 'D1_ERROR' } }), true);
  assert.equal(normalizeWebSocketUrl('https://example.test/tail'), 'wss://example.test/tail');
  assert.equal(normalizeWebSocketUrl('wss://example.test/tail'), 'wss://example.test/tail');
  assert.throws(() => normalizeWebSocketUrl(''), /valid WebSocket URL/);
  assert.equal(await messageDataToText('text'), 'text');
  assert.equal(await messageDataToText(new TextEncoder().encode('bytes')), 'bytes');
  await assert.rejects(() => messageDataToText({}), /Unsupported live-tail/);
  assert.deepEqual(parseLiveTailMessage('{"ok":true}'), { ok: true });
  assert.deepEqual(parseLiveTailMessage('token=secret'), { unparsed: true, byteLength: 12 });
  assert.equal(JSON.stringify(parseLiveTailMessage('token=secret')).includes('secret'), false);
  console.log('live-tail outcome classification self-test passed');
}

if (process.argv.includes('--self-test')) {
  await selfTest();
  process.exit(0);
}

if (!token || !account || !worker) {
  throw new Error('CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and LIVE_TAIL_WORKER are required');
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'github-actions-cloudflare-live-tail',
};

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!response.ok || data?.success === false || data?.errors?.length) {
    throw new Error(`Cloudflare API ${response.status}: ${text.slice(0, 1200)}`);
  }
  return data;
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value;
  const lower = key.toLowerCase();
  if (['headers', 'cookies', 'authorization', 'token', 'secret'].some((name) => lower.includes(name))) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    if (lower.includes('url')) {
      try {
        const parsed = new URL(value);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.slice(0, 240);
      } catch {}
    }
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, key));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([childKey]) => !['cf', 'requestHeaders', 'responseHeaders'].includes(childKey))
        .map(([childKey, child]) => [childKey, sanitize(child, childKey)]),
    );
  }
  return value;
}

function findNumbers(value, path = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (typeof child === 'number' && /cpu.*time|time.*cpu/i.test(next)) found.push([next, child]);
    else if (child && typeof child === 'object') findNumbers(child, next, found);
  }
  return found;
}

async function probePath(host, path) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://${host}${path}`, { redirect: 'manual' });
    console.log(`LIVE_TAIL_PROBE=${path} status=${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

async function probeWorker() {
  if (!probes.length) return;
  try {
    const [accountSubdomain, scriptSubdomain] = await Promise.all([
      api(`/accounts/${account}/workers/subdomain`),
      api(`/accounts/${account}/workers/scripts/${encodeURIComponent(worker)}/subdomain`),
    ]);
    if (!scriptSubdomain.result?.enabled) {
      console.log('LIVE_TAIL_PROBE=workers.dev disabled');
      return;
    }
    const host = `${worker}.${accountSubdomain.result.subdomain}.workers.dev`;
    await Promise.all(probes.map((path) => probePath(host, path)));
  } catch (error) {
    console.log(`LIVE_TAIL_PROBE_WARNING=${String(error.message || error).slice(0, 500)}`);
  }
}

console.log(`LIVE_TAIL_START worker=${worker} seconds=${durationMs / 1000}`);
const prepared = await api(`/accounts/${account}/workers/observability/telemetry/live-tail`, {
  method: 'POST',
  body: JSON.stringify({ scriptId: worker }),
});
const wsUrl = normalizeWebSocketUrl(prepared.result?.wsUrl);

const socket = new WebSocket(wsUrl);
let events = 0;
let errors = 0;
let maxCpu = null;
let heartbeat;
let timer;
let connected = false;
let probePromise = Promise.resolve();
const pendingMessages = new Set();

const finished = new Promise((resolve, reject) => {
  timer = setTimeout(() => {
    try { socket.close(1000, 'connection timeout'); } catch {}
    reject(new Error(`Live tail WebSocket did not connect within ${connectionTimeoutMs / 1000} seconds`));
  }, connectionTimeoutMs);

  socket.addEventListener('open', async () => {
    connected = true;
    clearTimeout(timer);
    console.log('LIVE_TAIL_CONNECTED=true');
    heartbeat = setInterval(() => {
      api(`/accounts/${account}/workers/observability/telemetry/live-tail/heartbeat`, {
        method: 'POST',
        body: JSON.stringify({ scriptId: worker }),
      }).catch((error) => console.log(`LIVE_TAIL_HEARTBEAT_WARNING=${String(error.message || error).slice(0, 300)}`));
    }, 25_000);
    probePromise = probeWorker();
    timer = setTimeout(() => socket.close(1000, 'diagnostic complete'), durationMs);
  });
  socket.addEventListener('message', (message) => {
    const processing = (async () => {
      const text = await messageDataToText(message.data);
      const parsed = parseLiveTailMessage(text);
      const safe = sanitize(parsed);
      const cpu = findNumbers(safe);
      for (const [, value] of cpu) maxCpu = maxCpu === null ? value : Math.max(maxCpu, value);
      const compact = JSON.stringify(safe);
      if (isErrorLike(safe)) errors += 1;
      events += 1;
      console.log(`LIVE_TAIL_EVENT=${compact}`);
      if (cpu.length) console.log(`LIVE_TAIL_CPU=${JSON.stringify(cpu)}`);
    })();
    pendingMessages.add(processing);
    processing
      .catch((error) => {
        try { socket.close(1011, 'message processing failed'); } catch {}
        reject(new Error(`Live tail message processing failed: ${error.message || error}`));
      })
      .finally(() => pendingMessages.delete(processing));
  });
  socket.addEventListener('error', (event) => {
    try { socket.close(1011, 'websocket error'); } catch {}
    reject(new Error(`Live tail WebSocket error: ${event.message || 'unknown'}`));
  });
  socket.addEventListener('close', () => {
    void Promise.allSettled([...pendingMessages]).then(() => {
      if (connected) resolve();
      else reject(new Error('Live tail WebSocket closed before connecting'));
    });
  });
});

try {
  await finished;
  await probePromise;
} finally {
  clearInterval(heartbeat);
  clearTimeout(timer);
}
console.log(`LIVE_TAIL_SUMMARY worker=${worker} events=${events} error_like=${errors} max_cpu_field=${maxCpu}`);
