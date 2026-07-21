const token = String(
  process.env.CLOUDFLARE_BUILDS_API_TOKEN
  || process.env.CLOUDFLARE_API_TOKEN
  || ''
).trim();
let accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const providerAccount = String(process.env.CLOUDFLARE_GIT_PROVIDER_ACCOUNT || 'tarematsu').trim().toLowerCase();
const repositoryName = String(process.env.CLOUDFLARE_GIT_REPOSITORY || 'HP').trim().toLowerCase();
const apiBase = 'https://api.cloudflare.com/client/v4';

if (!token) {
  throw new Error('CLOUDFLARE_BUILDS_API_TOKEN is required to enforce Actions-only deployments');
}

async function cloudflare(path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Cloudflare API returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok || payload?.success === false) {
    const errors = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => `${error?.code || 'error'}: ${error?.message || 'unknown error'}`).join('; ')
      : text.slice(0, 300);
    throw new Error(`Cloudflare API ${response.status} for ${path}: ${errors || 'request failed'}`);
  }
  return payload;
}

if (!accountId) {
  const payload = await cloudflare('/accounts?page=1&per_page=100');
  const accounts = Array.isArray(payload?.result) ? payload.result : [];
  if (accounts.length !== 1 || !accounts[0]?.id) {
    throw new Error('Cloudflare account could not be inferred uniquely');
  }
  accountId = String(accounts[0].id);
}

const scriptsPayload = await cloudflare(`/accounts/${encodeURIComponent(accountId)}/workers/scripts`);
const scripts = Array.isArray(scriptsPayload?.result) ? scriptsPayload.result : [];
const forbidden = [];

for (const script of scripts) {
  const tag = String(script?.tag || '').trim();
  if (!tag) continue;
  const triggersPayload = await cloudflare(
    `/accounts/${encodeURIComponent(accountId)}/builds/workers/${encodeURIComponent(tag)}/triggers`
  );
  for (const trigger of Array.isArray(triggersPayload?.result) ? triggersPayload.result : []) {
    const connection = trigger?.repo_connection || {};
    const accountMatches = String(connection?.provider_account_name || '').trim().toLowerCase() === providerAccount;
    const repositoryMatches = String(connection?.repo_name || '').trim().toLowerCase() === repositoryName;
    if (!accountMatches || !repositoryMatches) continue;
    forbidden.push({
      worker: String(script?.id || tag),
      trigger: String(trigger?.trigger_name || trigger?.trigger_uuid || 'unknown'),
    });
  }
}

if (forbidden.length) {
  throw new Error(
    `Cloudflare Git-integrated build triggers are forbidden for ${providerAccount}/${repositoryName}: `
    + forbidden.map((entry) => `${entry.worker}/${entry.trigger}`).join(', ')
  );
}

console.log(JSON.stringify({
  policy: 'github-actions-only',
  accountId,
  repository: `${providerAccount}/${repositoryName}`,
  matchingCloudflareBuildTriggers: 0,
}, null, 2));
