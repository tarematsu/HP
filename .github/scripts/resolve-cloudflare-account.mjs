#!/usr/bin/env node

import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ACCOUNTS_URL = 'https://api.cloudflare.com/client/v4/accounts?per_page=50';
const ACCOUNT_URL = (accountId) => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
const MAX_LOOKUP_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 8000;

function singleLine(name, value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (/[\r\n]/.test(normalized)) throw new Error(`${name} must be a single line`);
  return normalized;
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(attempt) {
  return Math.min(1000 * (2 ** (attempt - 1)), MAX_RETRY_DELAY_MS);
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function defaultRetryLogger({ attempt, delayMs, status, reason }) {
  const statusText = status == null ? 'network error' : `HTTP ${status}`;
  console.warn(
    `Cloudflare account lookup ${statusText}; retrying after ${delayMs}ms `
      + `(attempt ${attempt + 1}/${MAX_LOOKUP_ATTEMPTS}): ${reason}`,
  );
}

async function retryLookup({ error, status, attempt, sleepImpl, onRetry }) {
  if (attempt >= MAX_LOOKUP_ATTEMPTS || (status != null && !retryableStatus(status))) {
    throw error;
  }
  const delayMs = retryDelayMs(attempt);
  onRetry({
    attempt,
    delayMs,
    status,
    reason: String(error?.message || error),
  });
  await sleepImpl(delayMs);
}

async function requestCloudflareJson(
  url,
  apiToken,
  fetchImpl,
  { sleepImpl = sleep, onRetry = defaultRetryLogger } = {},
) {
  for (let attempt = 1; attempt <= MAX_LOOKUP_ATTEMPTS; attempt += 1) {
    let response;
    let text;
    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
        },
      });
      text = await response.text();
    } catch (cause) {
      const error = new Error(
        `Cloudflare account lookup request failed: ${String(cause?.message || cause || 'unknown error')}`,
      );
      await retryLookup({ error, status: null, attempt, sleepImpl, onRetry });
      continue;
    }

    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      const error = new Error(`Cloudflare account lookup returned invalid JSON (${response.status})`);
      await retryLookup({
        error,
        status: Number(response.status),
        attempt,
        sleepImpl,
        onRetry,
      });
      continue;
    }

    if (!response.ok || payload?.success === false || payload?.errors?.length) {
      const detail = (payload?.errors || [])
        .map((item) => String(item?.message || 'unknown error'))
        .join('; ');
      const error = new Error(`Cloudflare account lookup failed: ${detail || response.status}`);
      await retryLookup({
        error,
        status: Number(response.status),
        attempt,
        sleepImpl,
        onRetry,
      });
      continue;
    }
    return payload;
  }
  throw new Error('Cloudflare account lookup exhausted retries');
}

export async function resolveCloudflareAccountId({
  token = '',
  accountId = '',
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  onRetry = defaultRetryLogger,
}) {
  const apiToken = singleLine('Cloudflare API token', token);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  if (typeof sleepImpl !== 'function') throw new Error('sleep implementation is required');
  if (typeof onRetry !== 'function') throw new Error('retry callback is required');

  const requestOptions = { sleepImpl, onRetry };
  const explicit = String(accountId || '').trim();
  if (explicit) {
    const requestedAccountId = singleLine('Cloudflare account ID', explicit);
    const payload = await requestCloudflareJson(
      ACCOUNT_URL(requestedAccountId),
      apiToken,
      fetchImpl,
      requestOptions,
    );
    const resolvedAccountId = singleLine('Cloudflare account ID', payload?.result?.id);
    if (resolvedAccountId !== requestedAccountId) {
      throw new Error('Cloudflare account lookup returned a different account ID');
    }
    return resolvedAccountId;
  }

  const payload = await requestCloudflareJson(ACCOUNTS_URL, apiToken, fetchImpl, requestOptions);
  const ids = (Array.isArray(payload?.result) ? payload.result : [])
    .map((account) => String(account?.id || '').trim())
    .filter(Boolean);
  if (ids.length !== 1) {
    throw new Error(`Expected exactly one accessible Cloudflare account, found ${ids.length}`);
  }
  return singleLine('Cloudflare account ID', ids[0]);
}

export async function exportCloudflareContext({
  token,
  accountId = '',
  envFile,
  fetchImpl,
  sleepImpl,
  onRetry,
}) {
  const apiToken = singleLine('Cloudflare API token', token);
  const output = singleLine('GITHUB_ENV', envFile);
  const resolvedAccountId = await resolveCloudflareAccountId({
    token: apiToken,
    accountId,
    fetchImpl,
    sleepImpl,
    onRetry,
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
