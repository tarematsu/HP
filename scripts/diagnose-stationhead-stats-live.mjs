import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const API_BASE = 'https://production1.stationhead.com';
const HANDLE = process.env.STATIONHEAD_DIAGNOSTIC_HANDLE || 'sakuramankai';
const FALLBACK_CHANNEL_ID = Number(process.env.STATIONHEAD_DIAGNOSTIC_CHANNEL_ID || 318);
const OUT = path.resolve(process.env.STATIONHEAD_DIAGNOSTIC_OUT || '.sh-stats-diagnostic/report.json');

function tokenPayload(token) {
  try {
    const part = String(token || '').split('.')[1] || '';
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function summarizePayload(payload) {
  const object = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const chart = Array.isArray(object.chart_data) ? object.chart_data
    : Array.isArray(object.chartData) ? object.chartData
      : Array.isArray(object.data?.chart_data) ? object.data.chart_data
        : Array.isArray(object.data?.chartData) ? object.data.chartData
          : [];
  const values = chart.map((point) => Number(point?.val ?? point?.value ?? point?.count ?? point?.plays ?? point?.listens))
    .filter(Number.isFinite);
  return {
    keys: Object.keys(object).slice(0, 24),
    dataKeys: object.data && typeof object.data === 'object' ? Object.keys(object.data).slice(0, 24) : [],
    chartLength: chart.length,
    firstPointKeys: chart[0] && typeof chart[0] === 'object' ? Object.keys(chart[0]).slice(0, 16) : [],
    firstValue: values.length ? values[0] : null,
    lastValue: values.length ? values.at(-1) : null,
    nonZeroValues: values.filter((value) => value !== 0).length,
  };
}

async function request(pathname, init = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { response, text, json };
}

const deviceUid = randomUUID();
const baseHeaders = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
  'app-platform': 'web',
  'app-version': '1.0.0',
  'content-type': 'application/json',
  origin: 'https://www.stationhead.com',
  referer: 'https://www.stationhead.com/',
  'sth-device-uid': deviceUid,
};

const tokenResult = await request('/web/token', {
  method: 'POST',
  headers: baseHeaders,
  body: '',
});
const authorization = tokenResult.response.headers.get('authorization') || '';
const bearer = authorization.replace(/^Bearer\s+/i, '');
if (!tokenResult.response.ok || !bearer) {
  throw new Error(`guest token failed: status=${tokenResult.response.status}`);
}

const authHeaders = { ...baseHeaders, authorization: `Bearer ${bearer}` };
const loginResult = await request('/web/guest/login', {
  method: 'POST',
  headers: authHeaders,
  body: '',
});
if (!loginResult.response.ok) {
  throw new Error(`guest login failed: status=${loginResult.response.status}`);
}

const stationResult = await request(`/station/handle/${encodeURIComponent(HANDLE)}/guest`, {
  method: 'POST',
  headers: authHeaders,
  body: '{}',
});
if (!stationResult.response.ok || !stationResult.json) {
  throw new Error(`station lookup failed: status=${stationResult.response.status}`);
}

const resolvedChannelId = Number(stationResult.json?.channel?.id || 0) || null;
const channelIds = [...new Set([resolvedChannelId, FALLBACK_CHANNEL_ID].filter((value) => Number.isFinite(value) && value > 0))];
const stats = [];
for (const channelId of channelIds) {
  const result = await request(`/me/channel/${channelId}/streakStats`, {
    method: 'GET',
    headers: { ...authHeaders, accept: 'application/json' },
  });
  stats.push({
    channelId,
    status: result.response.status,
    ok: result.response.ok,
    contentType: result.response.headers.get('content-type') || '',
    payload: summarizePayload(result.json),
    bodyLength: result.text.length,
  });
}

const claims = tokenPayload(bearer) || {};
const tokenClass = ['string', 'number', 'boolean'].includes(typeof claims.class)
  ? claims.class
  : null;
const report = {
  handle: HANDLE,
  stationStatus: stationResult.response.status,
  stationId: Number(stationResult.json?.id || stationResult.json?.broadcast?.station_id || 0) || null,
  resolvedChannelId,
  configuredChannelId: FALLBACK_CHANNEL_ID,
  channelMatchesConfigured: resolvedChannelId === FALLBACK_CHANNEL_ID,
  guestTokenClaimKeys: Object.keys(claims).sort(),
  guestTokenClass: tokenClass,
  guestIndicators: {
    guest: Boolean(claims.guest ?? claims.is_guest ?? claims.isGuest),
    hasAccountId: Boolean(claims.account_id ?? claims.accountId ?? claims.user_id ?? claims.userId ?? claims.sub),
  },
  stats,
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
