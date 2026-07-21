const API_BASE = 'https://api.cloudflare.com/client/v4';
const QUEUE_NAME = process.env.MANUAL_IMPORT_QUEUE || 'videoscraper-manual-imports';
const token = String(process.env.CLOUDFLARE_API_TOKEN || '');
const configuredAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();

if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not configured');

async function cloudflare(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const details = (payload?.errors || [])
      .map((error) => `${error.code || 'unknown'}:${error.message || 'Cloudflare API error'}`)
      .join(', ');
    throw new Error(`Cloudflare API ${response.status}: ${details || 'request failed'}`);
  }
  return payload.result;
}

async function accountIds() {
  if (configuredAccountId) return [configuredAccountId];
  const accounts = await cloudflare('/accounts?per_page=50');
  const ids = (accounts || []).map((account) => String(account?.id || '')).filter(Boolean);
  if (!ids.length) throw new Error('No Cloudflare account is available to the API token');
  return ids;
}

async function resolveQueue() {
  const matches = [];
  for (const accountId of await accountIds()) {
    const queues = await cloudflare(`/accounts/${accountId}/queues?per_page=100`);
    for (const queue of queues || []) {
      const name = String(queue?.queue_name || queue?.name || '');
      if (name !== QUEUE_NAME) continue;
      const queueId = String(queue?.queue_id || queue?.id || '');
      if (queueId) matches.push({ accountId, queueId });
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one ${QUEUE_NAME} queue, found ${matches.length}`);
  }
  return matches[0];
}

const { accountId, queueId } = await resolveQueue();
await cloudflare(`/accounts/${accountId}/queues/${queueId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    body: { type: 'manual-import-recovery' },
    content_type: 'json'
  })
});
console.log(`Queued one manual-import recovery message for ${QUEUE_NAME}`);
