const API_BASE = 'https://api.cloudflare.com/client/v4';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPlaceholderD1DatabaseId(value) {
  return String(value || '').trim().toLowerCase() === ZERO_UUID;
}

export async function resolveConfiguredD1DatabaseId({
  databaseId,
  databaseName,
  token,
  accountId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const configuredId = String(databaseId || '').trim().toLowerCase();
  if (configuredId && !isPlaceholderD1DatabaseId(configuredId)) return configuredId;

  const name = String(databaseName || '').trim();
  if (!name) throw new Error('A database name is required to resolve a placeholder D1 database ID');
  if (!String(token || '').trim() || !String(accountId || '').trim()) {
    throw new Error(`Cloudflare credentials are required to resolve D1 database ${name}`);
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required to resolve a D1 database ID');

  const url = new URL(`${API_BASE}/accounts/${encodeURIComponent(String(accountId).trim())}/d1/database`);
  url.searchParams.set('name', name);
  url.searchParams.set('per_page', '100');

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${String(token).trim()}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare D1 lookup returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok || body?.success === false || body?.errors?.length) {
    throw new Error(`Cloudflare D1 lookup failed (${response.status}): ${JSON.stringify(body?.errors || body).slice(0, 600)}`);
  }

  const rows = Array.isArray(body?.result) ? body.result : [];
  const matches = rows.filter((row) => {
    const id = String(row?.uuid || row?.id || row?.database_id || '').trim();
    return String(row?.name || '') === name
      && UUID_PATTERN.test(id)
      && !isPlaceholderD1DatabaseId(id);
  });
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Cloudflare D1 database named ${name}, found ${matches.length}`);
  }
  return String(matches[0].uuid || matches[0].id || matches[0].database_id).toLowerCase();
}
