const API_BASE = 'https://api.cloudflare.com/client/v4';
const QUEUE_NAME = process.env.MANUAL_IMPORT_QUEUE || 'videoscraper-manual-imports';
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();

if (!token || !accountId) {
  throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
}

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

async function resolveQueueId() {
  const queues = await cloudflare(`/accounts/${accountId}/queues?per_page=100`);
  const matches = (queues || [])
    .filter((queue) => String(queue?.queue_name || queue?.name || '') === QUEUE_NAME)
    .map((queue) => String(queue?.queue_id || queue?.id || ''))
    .filter(Boolean);
  if (matches.length !== 1) {
    throw new Error(`Expected one ${QUEUE_NAME} queue in the resolved account, found ${matches.length}`);
  }
  return matches[0];
}

const queueId = await resolveQueueId();
await cloudflare(`/accounts/${accountId}/queues/${queueId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    body: { type: 'manual-import-recovery' },
    content_type: 'json'
  })
});
console.log(`Queued one manual-import recovery message for ${QUEUE_NAME}`);
