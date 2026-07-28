#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const QUEUE_PAGE_SIZE = 100;

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

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

async function responsePayload(response, operation) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    if (!response.ok) throw new Error(`${operation} returned invalid JSON (${response.status})`);
    return {};
  }
}

async function apiRequest({ fetchImpl, token, url, method = 'GET', operation }) {
  const response = await fetchImpl(url, { method, headers: headers(token) });
  const payload = await responsePayload(response, operation);
  const codes = errorCodes(payload);
  if (!response.ok || payload?.success === false || codes.length) {
    throw new Error(`${operation} failed: ${errorDetail(payload, `HTTP ${response.status}`)}`);
  }
  return payload;
}

function queueId(queue) {
  return String(queue?.queue_id || queue?.id || '').trim();
}

function workerConsumers(consumers, scriptName) {
  return (Array.isArray(consumers) ? consumers : []).filter((consumer) => (
    String(consumer?.type || 'worker') === 'worker'
      && String(consumer?.script_name || '').trim() === scriptName
      && String(consumer?.consumer_id || '').trim()
  ));
}

async function listQueues({ account, token, fetchImpl }) {
  const queues = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = `${API_BASE}/accounts/${encodeURIComponent(account)}/queues?per_page=${QUEUE_PAGE_SIZE}&page=${page}`;
    const payload = await apiRequest({
      fetchImpl,
      token,
      url,
      operation: 'Cloudflare Queue listing',
    });
    const batch = Array.isArray(payload?.result) ? payload.result : [];
    queues.push(...batch);
    const totalPages = Number(payload?.result_info?.total_pages);
    if ((Number.isFinite(totalPages) && page >= totalPages) || batch.length < QUEUE_PAGE_SIZE) break;
  }
  return queues;
}

async function queueConsumers({ account, token, fetchImpl, queue }) {
  if (Array.isArray(queue?.consumers)) return queue.consumers;
  const id = queueId(queue);
  if (!id) return [];
  const url = `${API_BASE}/accounts/${encodeURIComponent(account)}/queues/${encodeURIComponent(id)}/consumers`;
  const payload = await apiRequest({
    fetchImpl,
    token,
    url,
    operation: `Cloudflare Queue consumer listing (${id})`,
  });
  return Array.isArray(payload?.result) ? payload.result : [];
}

export async function detachQueueConsumersForWorker({
  accountId,
  apiToken,
  scriptName,
  fetchImpl = globalThis.fetch,
}) {
  const account = singleLine('Cloudflare account ID', accountId);
  const token = singleLine('Cloudflare API token', apiToken);
  const worker = singleLine('Cloudflare Worker name', scriptName);
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const detached = [];
  for (const queue of await listQueues({ account, token, fetchImpl })) {
    const id = queueId(queue);
    if (!id) continue;
    const consumers = await queueConsumers({ account, token, fetchImpl, queue });
    for (const consumer of workerConsumers(consumers, worker)) {
      const consumerId = String(consumer.consumer_id).trim();
      const url = `${API_BASE}/accounts/${encodeURIComponent(account)}/queues/${encodeURIComponent(id)}/consumers/${encodeURIComponent(consumerId)}`;
      await apiRequest({
        fetchImpl,
        token,
        url,
        method: 'DELETE',
        operation: `Cloudflare Queue consumer deletion (${worker})`,
      });
      detached.push({
        queueId: id,
        queueName: String(queue?.queue_name || consumer?.queue_name || id),
        consumerId,
      });
    }
  }
  return detached;
}

async function deleteWorkerOnce({ account, token, worker, fetchImpl }) {
  const url = `${API_BASE}/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(worker)}?force=true`;
  const response = await fetchImpl(url, {
    method: 'DELETE',
    headers: headers(token),
  });
  const payload = await responsePayload(response, 'Cloudflare Worker deletion');
  const codes = errorCodes(payload);
  if (response.status === 404 || codes.includes(10090)) {
    return { deleted: false, alreadyAbsent: true, conflict: false, detail: '' };
  }
  if (!response.ok || payload?.success === false || codes.length) {
    const detail = errorDetail(payload, `HTTP ${response.status}`);
    return {
      deleted: false,
      alreadyAbsent: false,
      conflict: /consumer for a Queue|Queue['’]s consumers/i.test(detail),
      detail,
    };
  }
  return { deleted: true, alreadyAbsent: false, conflict: false, detail: '' };
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

  const first = await deleteWorkerOnce({ account, token, worker, fetchImpl });
  if (first.deleted || first.alreadyAbsent) {
    return { deleted: first.deleted, alreadyAbsent: first.alreadyAbsent };
  }
  if (!first.conflict) {
    throw new Error(`Cloudflare Worker deletion failed: ${first.detail}`);
  }

  const detached = await detachQueueConsumersForWorker({
    accountId: account,
    apiToken: token,
    scriptName: worker,
    fetchImpl,
  });
  if (!detached.length) {
    throw new Error(`Cloudflare Worker deletion failed: ${first.detail}; no matching Queue consumer was found`);
  }

  const second = await deleteWorkerOnce({ account, token, worker, fetchImpl });
  if (!second.deleted && !second.alreadyAbsent) {
    throw new Error(`Cloudflare Worker deletion failed after detaching ${detached.length} Queue consumer(s): ${second.detail}`);
  }
  return {
    deleted: second.deleted,
    alreadyAbsent: second.alreadyAbsent,
    detachedConsumers: detached.length,
  };
}

async function main() {
  const scriptName = singleLine('Cloudflare Worker name', process.argv[2]);
  const result = await deleteCloudflareWorker({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_BUILDS_API_TOKEN,
    scriptName,
  });
  if (result.detachedConsumers) {
    console.log(`${scriptName}: detached ${result.detachedConsumers} Queue consumer(s).`);
  }
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
