import { spawn } from 'node:child_process';

export const DATABASE_ID_KEYS = ['PRODUCTION_D1_DATABASE_ID', 'DATABASE_ID'];
export const DATABASE_NAME_KEYS = ['PRODUCTION_D1_DATABASE_NAME', 'D1_DATABASE_NAME', 'DATABASE_NAME'];
export const ACCOUNT_ID_KEYS = ['CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID'];
export const API_TOKEN_KEYS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_BUILDS_API_TOKEN', 'CF_API_TOKEN'];
const AUTO_NAME_NEEDLE = 'video';

export function firstEnv(keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function normalizeEntry(entry) {
  const name = String(entry?.name || '').trim();
  const id = String(entry?.uuid || entry?.id || entry?.database_id || '').trim();
  return name && id ? { name, id } : null;
}

function entriesFromPayload(payload) {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : Array.isArray(payload?.databases)
        ? payload.databases
        : [];
  return raw.map(normalizeEntry).filter(Boolean);
}

export function selectDatabase(entries, preferredName) {
  if (!entries.length) return null;
  if (preferredName) {
    const exact = entries.find((entry) => entry.name === preferredName);
    if (exact) return exact;
  }

  const matches = entries.filter((entry) => entry.name.toLowerCase().includes(AUTO_NAME_NEEDLE));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const names = matches.map((entry) => entry.name).join(', ');
    throw new Error(`Multiple D1 databases containing "${AUTO_NAME_NEEDLE}" found (${names}). Set ${DATABASE_NAME_KEYS.join(' or ')} to choose one.`);
  }

  if (entries.length === 1) return entries[0];
  const names = entries.map((entry) => entry.name).join(', ');
  throw new Error(`Multiple D1 databases found (${names}), and none contains "${AUTO_NAME_NEEDLE}". Set ${DATABASE_NAME_KEYS.join(' or ')} to choose one.`);
}

async function cloudflareRequest(url, apiToken) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json'
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const message = (payload.errors || []).map((error) => error?.message).filter(Boolean).join('; ') || response.statusText;
    throw new Error(`Cloudflare API failed: ${message}`);
  }
  return payload;
}

export async function resolveAccountId(apiToken) {
  const configured = firstEnv(ACCOUNT_ID_KEYS);
  if (configured) return configured;
  if (!apiToken) return '';

  const payload = await cloudflareRequest(
    'https://api.cloudflare.com/client/v4/accounts?per_page=50',
    apiToken
  );
  const accounts = (payload.result || [])
    .map((entry) => ({ id: String(entry?.id || '').trim(), name: String(entry?.name || '').trim() }))
    .filter((entry) => entry.id);

  if (accounts.length === 1) return accounts[0].id;
  const matches = accounts.filter((entry) => entry.name.toLowerCase().includes(AUTO_NAME_NEEDLE));
  if (matches.length === 1) return matches[0].id;

  const names = accounts.map((entry) => entry.name || entry.id).join(', ');
  throw new Error(`Cloudflare account could not be selected automatically (${names || 'none found'}). Set ${ACCOUNT_ID_KEYS.join(' or ')}.`);
}

async function listDatabasesFromApi() {
  const apiToken = firstEnv(API_TOKEN_KEYS);
  if (!apiToken) return [];
  const accountId = await resolveAccountId(apiToken);
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database`;
  return entriesFromPayload(await cloudflareRequest(url, apiToken));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout}`));
    });
  });
}

async function listDatabasesFromWrangler() {
  const output = await run('npx', ['wrangler', 'd1', 'list', '--json']);
  return entriesFromPayload(JSON.parse(output));
}

export async function resolveD1Database(preferredName = '') {
  const explicitId = firstEnv(DATABASE_ID_KEYS);
  const explicitName = firstEnv(DATABASE_NAME_KEYS) || preferredName;
  if (explicitId) return { name: explicitName || 'configured-d1-database', id: explicitId };

  const apiMatch = selectDatabase(await listDatabasesFromApi(), explicitName);
  if (apiMatch) return apiMatch;

  const wranglerMatch = selectDatabase(await listDatabasesFromWrangler(), explicitName);
  if (wranglerMatch) return wranglerMatch;

  return null;
}
