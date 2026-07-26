#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PUBLIC_HEALTH_ENDPOINTS = [
  { name: 'Overall health', url: 'https://skrzk.pages.dev/api/health' },
  { name: 'Minute pipeline', url: 'https://skrzk.pages.dev/api/health/minute' },
  { name: 'Other pipeline', url: 'https://skrzk.pages.dev/api/health/other' },
  { name: 'Sakurazaka46.jp pipeline', url: 'https://skrzk.pages.dev/api/health/sakurazaka46jp' },
];

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BODY_LIMIT = 2_000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function endpointName(url, index) {
  try {
    const pathname = new URL(url).pathname.replace(/^\/+/, '') || 'root';
    return pathname.replaceAll('/', ' / ');
  } catch {
    return `Endpoint ${index + 1}`;
  }
}

export function publicHealthEndpoints(value = process.env.PUBLIC_HEALTH_ENDPOINTS) {
  const configured = String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!configured.length) return DEFAULT_PUBLIC_HEALTH_ENDPOINTS;
  return configured.map((url, index) => ({ name: endpointName(url, index), url }));
}

export function formatResponseBody(text, contentType = '') {
  const body = String(text || '').trim();
  if (!body) return '(empty response body)';
  if (/json/i.test(contentType) || /^[\[{]/.test(body)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Preserve malformed JSON as returned so it remains useful diagnostics.
    }
  }
  return body;
}

function clipBody(body, maximum) {
  if (body.length <= maximum) return body;
  return `${body.slice(0, maximum)}\n…response body truncated…`;
}

function safeCodeFence(body) {
  return String(body || '').replaceAll('```', '``\u200b`');
}

function errorMessage(error) {
  if (error?.name === 'AbortError') return 'request timed out';
  return String(error?.message || error || 'request failed').replaceAll('\n', ' ').slice(0, 500);
}

export async function capturePublicHealthEndpoint(endpoint, {
  fetchImpl = fetch,
  timeoutMs = positiveInteger(process.env.PUBLIC_HEALTH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  bodyLimit = positiveInteger(process.env.PUBLIC_HEALTH_BODY_LIMIT, DEFAULT_BODY_LIMIT),
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(endpoint.url, {
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        'User-Agent': 'HP-observability-health-capture',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = String(response.headers?.get?.('content-type') || 'unknown');
    const body = clipBody(formatResponseBody(await response.text(), contentType), bodyLimit);
    return {
      ...endpoint,
      ok: Boolean(response.ok),
      status: Number(response.status),
      statusText: String(response.statusText || ''),
      contentType,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      body,
      error: '',
    };
  } catch (error) {
    return {
      ...endpoint,
      ok: false,
      status: null,
      statusText: '',
      contentType: 'unavailable',
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      body: '(response unavailable)',
      error: errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function markdownCell(value) {
  return String(value || '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function statusLabel(result) {
  if (result.status == null) return result.error || 'request failed';
  return `${result.status}${result.statusText ? ` ${result.statusText}` : ''}`;
}

export function renderPublicHealthReport(results, generatedAt = new Date().toISOString()) {
  const rows = results.map((result) => (
    `| ${markdownCell(result.name)} | ${result.ok ? 'success' : 'failure'} | ${markdownCell(statusLabel(result))} | ${result.elapsedMs} ms |`
  )).join('\n');
  const details = results.map((result) => {
    const language = /json/i.test(result.contentType) ? 'json' : 'text';
    const error = result.error ? `\n- **Error:** ${result.error}` : '';
    return `<details>\n<summary><code>${result.url}</code> — ${statusLabel(result)} (${result.elapsedMs} ms)</summary>\n\n- **Name:** ${result.name}\n- **Result:** ${result.ok ? 'success' : 'failure'}\n- **Content-Type:** ${result.contentType}${error}\n\n\`\`\`${language}\n${safeCodeFence(result.body)}\n\`\`\`\n\n</details>`;
  }).join('\n\n');
  return `## Public health endpoint snapshots\n\n- **Captured:** ${generatedAt}\n- **Endpoints:** ${results.length}\n\n| Endpoint | Result | HTTP / error | Latency |\n|---|---|---|---|\n${rows || '| - | failure | no endpoints configured | - |'}\n\n${details}`;
}

export async function captureFromEnvironment() {
  const endpoints = publicHealthEndpoints();
  const results = await Promise.all(endpoints.map((endpoint) => capturePublicHealthEndpoint(endpoint)));
  const report = renderPublicHealthReport(results);
  const output = String(process.env.PUBLIC_HEALTH_OUTPUT || 'public-health-endpoints.md').trim();
  await writeFile(output, `${report}\n`, 'utf8');
  console.log(report);
  if (results.some((result) => !result.ok)) process.exitCode = 1;
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  captureFromEnvironment().catch((error) => {
    console.error(`::error title=Capture public health endpoints::${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
