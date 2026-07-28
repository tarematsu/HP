#!/usr/bin/env node

import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.cloudflare.com/client/v4';

function singleLine(name, value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (/[\r\n]/.test(normalized)) throw new Error(`${name} must be a single line`);
  return normalized;
}

function errorDetail(payload, fallback) {
  const detail = (Array.isArray(payload?.errors) ? payload.errors : [])
    .map((error) => String(error?.message || '').trim())
    .filter(Boolean)
    .join('; ');
  return detail || fallback;
}

async function cloudflareJson({ fetchImpl, token, url, operation }) {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${operation} returned invalid JSON (${response.status})`);
  }
  if (!response.ok || payload?.success === false || (Array.isArray(payload?.errors) && payload.errors.length)) {
    throw new Error(`${operation} failed: ${errorDetail(payload, `HTTP ${response.status}`)}`);
  }
  return payload;
}

function publicWorkerUrl(scriptName, subdomain) {
  const hostname = `${scriptName}.${subdomain}.workers.dev`.toLowerCase();
  const url = new URL(`https://${hostname}`);
  if (url.hostname !== hostname || url.pathname !== '/') {
    throw new Error('Cloudflare Worker public hostname is invalid');
  }
  return url.origin;
}

export async function resolveCloudflareWorkerPublicUrl({
  accountId,
  apiToken,
  scriptName,
  fetchImpl = globalThis.fetch,
}) {
  const account = singleLine('Cloudflare account ID', accountId);
  const token = singleLine('Cloudflare API token', apiToken);
  const worker = singleLine('Cloudflare Worker name', scriptName);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const encodedAccount = encodeURIComponent(account);
  const encodedWorker = encodeURIComponent(worker);
  const [accountSubdomain, workerSubdomain] = await Promise.all([
    cloudflareJson({
      fetchImpl,
      token,
      url: `${API_BASE}/accounts/${encodedAccount}/workers/subdomain`,
      operation: 'Cloudflare account Worker subdomain lookup',
    }),
    cloudflareJson({
      fetchImpl,
      token,
      url: `${API_BASE}/accounts/${encodedAccount}/workers/scripts/${encodedWorker}/subdomain`,
      operation: `Cloudflare Worker subdomain lookup (${worker})`,
    }),
  ]);

  const subdomain = singleLine('Cloudflare Workers subdomain', accountSubdomain?.result?.subdomain);
  if (workerSubdomain?.result?.enabled !== true) {
    throw new Error(`Cloudflare Worker ${worker} is not enabled on workers.dev`);
  }
  return publicWorkerUrl(worker, subdomain);
}

export function workerHealthUrl(baseUrl, path = '/') {
  const base = singleLine('Cloudflare Worker base URL', baseUrl);
  const healthPath = singleLine('Cloudflare Worker health path', path);
  return new URL(healthPath, `${base.replace(/\/$/, '')}/`).toString();
}

async function main() {
  const scriptName = singleLine('Cloudflare Worker name', process.argv[2]);
  const path = String(process.argv[3] || '/').trim() || '/';
  const baseUrl = await resolveCloudflareWorkerPublicUrl({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_BUILDS_API_TOKEN,
    scriptName,
  });
  const healthUrl = workerHealthUrl(baseUrl, path);
  const output = String(process.env.GITHUB_OUTPUT || '').trim();
  if (output) {
    await appendFile(output, `base-url=${baseUrl}\nhealth-url=${healthUrl}\n`, 'utf8');
  }
  console.log(`CLOUDFLARE_WORKER_URL worker=${scriptName} base_url=${baseUrl} health_url=${healthUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=Resolve Cloudflare Worker public URL::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
