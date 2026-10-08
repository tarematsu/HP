import {
  API_BASE,
  DEFAULT_USER_AGENT,
  STATIONHEAD_AUTH_PAGE_URL,
} from './collector-config.js';
import { jwtExpiryMs, normalizeBearer } from './shared.js';

function positive(value, fallback, maximum = 30_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), maximum);
}

export function stationheadGuestHeaders(
  { authToken = '', deviceUid = '' } = {},
  {
    appVersion = '1.0.0',
    referer = STATIONHEAD_AUTH_PAGE_URL,
  } = {},
) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    authorization: authToken ? `Bearer ${authToken}` : '',
    'app-platform': 'web',
    'app-version': appVersion,
    'content-type': 'application/json',
    origin: 'https://www.stationhead.com',
    referer,
    'sth-device-uid': deviceUid,
    'user-agent': DEFAULT_USER_AGENT,
  };
}

export async function acquireStationheadGuestSession(
  {
    appVersion = '1.0.0',
    requestTimeoutMs = 8_000,
    verifyHandle = null,
  } = {},
  fetchImpl = fetch,
) {
  const timeoutMs = positive(requestTimeoutMs, 8_000);
  const deviceUid = crypto.randomUUID();
  const headerConfig = { appVersion, referer: STATIONHEAD_AUTH_PAGE_URL };

  const tokenResponse = await fetchImpl(`${API_BASE}/web/token`, {
    method: 'POST',
    headers: stationheadGuestHeaders({ deviceUid }, headerConfig),
    body: '',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const authToken = normalizeBearer(tokenResponse.headers.get('authorization'));
  if (!tokenResponse.ok || !authToken) {
    throw new Error(`Stationhead guest token failed: ${tokenResponse.status}`);
  }

  const session = { authToken, deviceUid };
  const loginResponse = await fetchImpl(`${API_BASE}/web/guest/login`, {
    method: 'POST',
    headers: stationheadGuestHeaders(session, headerConfig),
    body: '',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!loginResponse.ok) {
    throw new Error(`Stationhead guest login failed: ${loginResponse.status}`);
  }

  const handle = String(verifyHandle || '').trim().toLowerCase();
  if (handle) {
    const verifyResponse = await fetchImpl(
      `${API_BASE}/station/handle/${encodeURIComponent(handle)}/guest`,
      {
        method: 'POST',
        headers: stationheadGuestHeaders(session, headerConfig),
        body: '',
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!verifyResponse.ok) {
      throw new Error(`Stationhead ${handle} auth verification failed: ${verifyResponse.status}`);
    }
    await verifyResponse.arrayBuffer().catch(() => {});
  }

  return {
    authToken,
    deviceUid,
    tokenExpiresAt: jwtExpiryMs(authToken) || null,
  };
}
