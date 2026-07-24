#!/usr/bin/env node

import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ACCOUNTS_URL = 'https://api.cloudflare.com/client/v4/accounts?per_page=50';

function singleLine(name, value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (/[\r\n]/.test(normalized)) throw new Error(`${name} must be a single line`);
  return normalized;
}

export async function resolveCloudflareAccountId({
  token,
  accountId = '',
  fetchImpl = globalThis.fetch,
}) {
  const apiToken = singleLine('Cloudflare API token', token);
  const explicit = String(accountId || '').trim();
  if (explicit) return singleLine('Cloudflare account ID', explicit);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const response = await fetchImpl(ACCOUNTS_URL, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Cloudflare account lookup returned invalid JSON (${response.status})`);
  }
  if (!response.ok || payload?.success === false || payload?.errors?.length) {
    const detail = (payload?.errors || [])
      .map((error) => String(error?.message || 'unknown error'))
      .join('; ');
    throw new Error(`Cloudflare account lookup failed: ${detail || response.status}`);
  }

  const ids = (Array.isArray(payload?.result) ? payload.result : [])
    .map((account) => String(account?.id || '').trim())
    .filter(Boolean);
  if (ids.length !== 1) {
    throw new Error(`Expected exactly one accessible Cloudflare account, found ${ids.length}`);
  }
  return singleLine('Cloudflare account ID', ids[0]);
}

export async function exportCloudflareContext({ token, accountId = '', envFile, fetchImpl }) {
  const apiToken = singleLine('Cloudflare API token', token);
  const output = singleLine('GITHUB_ENV', envFile);
  const resolvedAccountId = await resolveCloudflareAccountId({
    token: apiToken,
    accountId,
    fetchImpl,
  });
  await appendFile(output, [
    `CLOUDFLARE_API_TOKEN=${apiToken}`,
    `CLOUDFLARE_BUILDS_API_TOKEN=${apiToken}`,
    `CLOUDFLARE_ACCOUNT_ID=${resolvedAccountId}`,
    '',
  ].join('\n'), 'utf8');
  return resolvedAccountId;
}

async function main() {
  const token = singleLine('CLOUDFLARE_BUILDS_API_TOKEN', process.env.INPUT_API_TOKEN);
  console.log(`::add-mask::${token}`);
  await exportCloudflareContext({
    token,
    accountId: process.env.INPUT_ACCOUNT_ID,
    envFile: process.env.GITHUB_ENV,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=Resolve Cloudflare account::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
