#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT_NAME = 'sh-spotify-playcount-collector';
const API_ROOT = 'https://api.cloudflare.com/client/v4';

function required(name, value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (/[\r\n]/u.test(normalized)) throw new Error(`${name} must be a single line`);
  return normalized;
}

async function putSecret({ accountId, apiToken, name, value, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `${API_ROOT}/accounts/${encodeURIComponent(accountId)}`
      + `/workers/scripts/${encodeURIComponent(SCRIPT_NAME)}/secrets`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name, text: value, type: 'secret_text' }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const detail = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => String(item?.message || '')).filter(Boolean).join('; ')
      : '';
    throw new Error(`Cloudflare secret ${name} update failed: ${detail || response.status}`);
  }
}

export async function storeSpotifyChartsWorkerSecrets({
  refreshToken,
  accountId,
  apiToken,
  fetchImpl = fetch,
}) {
  const normalizedRefreshToken = required('Spotify refresh token', refreshToken);
  const normalizedAccountId = required('Cloudflare account ID', accountId);
  const normalizedApiToken = required('Cloudflare API token', apiToken);
  await putSecret({
    accountId: normalizedAccountId,
    apiToken: normalizedApiToken,
    name: 'SPOTIFY_CHARTS_REFRESH_TOKEN',
    value: normalizedRefreshToken,
    fetchImpl,
  });
  await putSecret({
    accountId: normalizedAccountId,
    apiToken: normalizedApiToken,
    name: 'CLOUDFLARE_WORKER_SECRET_TOKEN',
    value: normalizedApiToken,
    fetchImpl,
  });
  await putSecret({
    accountId: normalizedAccountId,
    apiToken: normalizedApiToken,
    name: 'CLOUDFLARE_WORKER_SECRET_ACCOUNT_ID',
    value: normalizedAccountId,
    fetchImpl,
  });
  return { stored: 3, script: SCRIPT_NAME };
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('refresh-token file path is required');
  const refreshToken = await readFile(resolve(path), 'utf8');
  const result = await storeSpotifyChartsWorkerSecrets({
    refreshToken,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_BUILDS_API_TOKEN,
  });
  console.log(JSON.stringify({ ok: true, event: 'spotify_charts_worker_secrets_stored', ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      event: 'spotify_charts_worker_secrets_store_failed',
      error: String(error?.message || error),
    }));
    process.exitCode = 1;
  });
}
