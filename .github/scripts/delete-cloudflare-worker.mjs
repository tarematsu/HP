#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

function singleLine(name, value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (/[\r\n]/.test(normalized)) throw new Error(`${name} must be a single line`);
  return normalized;
}

function errorCodes(payload) {
  return (Array.isArray(payload?.errors) ? payload.errors : [])
    .map((error) => Number(error?.code))
    .filter(Number.isFinite);
}

function errorDetail(payload, fallback) {
  const detail = (Array.isArray(payload?.errors) ? payload.errors : [])
    .map((error) => String(error?.message || '').trim())
    .filter(Boolean)
    .join('; ');
  return detail || fallback;
}

export async function deleteCloudflareWorker({
  accountId,
  apiToken,
  scriptName,
  fetchImpl = globalThis.fetch,
}) {
  const account = singleLine('Cloudflare account ID', accountId);
  const token = singleLine('Cloudflare API token', apiToken);
  const worker = singleLine('Cloudflare Worker name', scriptName);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(worker)}?force=true`;
  const response = await fetchImpl(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!response.ok) throw new Error(`Cloudflare Worker deletion returned invalid JSON (${response.status})`);
    }
  }

  const codes = errorCodes(payload);
  if (response.status === 404 || codes.includes(10090)) {
    return { deleted: false, alreadyAbsent: true };
  }
  if (!response.ok || payload?.success === false || codes.length) {
    throw new Error(`Cloudflare Worker deletion failed: ${errorDetail(payload, `HTTP ${response.status}`)}`);
  }
  return { deleted: true, alreadyAbsent: false };
}

async function main() {
  const scriptName = singleLine('Cloudflare Worker name', process.argv[2]);
  const result = await deleteCloudflareWorker({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_BUILDS_API_TOKEN,
    scriptName,
  });
  console.log(result.alreadyAbsent
    ? `${scriptName} is already absent.`
    : `${scriptName} deleted.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=Delete Cloudflare Worker::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
