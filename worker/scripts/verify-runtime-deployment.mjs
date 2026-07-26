const API_BASE = 'https://api.cloudflare.com/client/v4';
const DEFAULT_ATTEMPTS = 10;
const DEFAULT_DELAY_MS = 2_000;

function required(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required for runtime deployment verification`);
  return normalized;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function versionSet(value) {
  return new Set(Array.from(value || [], (item) => String(item || '').trim()).filter(Boolean));
}

function setsDiffer(left, right) {
  if (left.size !== right.size) return true;
  for (const value of left) if (!right.has(value)) return true;
  return false;
}

export function queueOnlyRuntimeDeployConfig(value = {}) {
  const config = structuredClone(value || {});
  config.triggers = { crons: [] };
  delete config.durable_objects;
  delete config.migrations;
  return config;
}

export function activeVersionIdsFromDeploymentPayload(payload) {
  const deployments = payload?.result?.deployments;
  if (!Array.isArray(deployments) || !deployments.length) {
    throw new Error('Cloudflare returned no active runtime deployment');
  }
  const versions = new Set(
    (deployments[0]?.versions || [])
      .filter((item) => Number(item?.percentage || 0) > 0)
      .map((item) => String(item?.version_id || '').trim())
      .filter(Boolean),
  );
  if (!versions.size) throw new Error('Cloudflare runtime deployment has no traffic-bearing version');
  return versions;
}

export function schedulesFromPayload(payload) {
  const result = payload?.result;
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.schedules)) return result.schedules;
  return [];
}

export function durableObjectBindingsFromPayload(payload) {
  const bindings = Array.isArray(payload?.result?.bindings) ? payload.result.bindings : [];
  return bindings.filter((binding) => /durable.?object/i.test(String(binding?.type || '')));
}

function tokenFromEnvironment(env = process.env) {
  return env.CLOUDFLARE_API_TOKEN
    || env.CF_API_TOKEN
    || env.CLOUDFLARE_BUILDS_API_TOKEN
    || '';
}

async function requestJson(path, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const accountId = required(options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID');
  const token = required(options.token || tokenFromEnvironment(options.env), 'Cloudflare API token');
  const response = await fetchImpl(`${API_BASE}/accounts/${encodeURIComponent(accountId)}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'user-agent': 'homepanel-runtime-deployment-verifier',
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Cloudflare returned invalid JSON for ${path}: ${text.slice(0, 500)}`);
  }
  if (!response.ok || payload?.success === false || (Array.isArray(payload?.errors) && payload.errors.length)) {
    throw new Error(`Cloudflare API failed for ${path}: ${JSON.stringify(payload?.errors || payload).slice(0, 800)}`);
  }
  return payload;
}

export async function readActiveRuntimeVersionIds(options = {}) {
  const scriptName = required(options.scriptName || 'sh-runtime-orchestrator', 'runtime script name');
  const payload = await requestJson(
    `/workers/scripts/${encodeURIComponent(scriptName)}/deployments`,
    options,
  );
  return activeVersionIdsFromDeploymentPayload(payload);
}

export async function verifyRuntimeDeployment(options = {}) {
  const scriptName = required(options.scriptName || 'sh-runtime-orchestrator', 'runtime script name');
  const previousVersionIds = versionSet(options.previousVersionIds);
  const allowUnchanged = options.allowUnchanged ?? enabled(process.env.ALLOW_UNCHANGED_RUNTIME_DEPLOYMENT);
  const attempts = positiveInteger(options.attempts, DEFAULT_ATTEMPTS, 60);
  const delayMs = positiveInteger(options.delayMs, DEFAULT_DELAY_MS, 30_000);
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  let activeVersionIds = new Set();
  let changed = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    activeVersionIds = await readActiveRuntimeVersionIds({ ...options, scriptName });
    changed = setsDiffer(previousVersionIds, activeVersionIds);
    if (changed || allowUnchanged) break;
    if (attempt < attempts) await sleep(delayMs);
  }
  if (!changed && !allowUnchanged) {
    throw new Error(`runtime deployment did not activate a new version; active=${[...activeVersionIds].join(',')}`);
  }

  const encodedScript = encodeURIComponent(scriptName);
  const schedules = schedulesFromPayload(await requestJson(
    `/workers/scripts/${encodedScript}/schedules`,
    options,
  ));
  if (schedules.length) {
    throw new Error(`runtime deployment still has cron triggers: ${schedules.map((item) => item?.cron || 'unknown').join(',')}`);
  }

  const settings = await requestJson(`/workers/scripts/${encodedScript}/settings`, options);
  const durableObjectBindings = durableObjectBindingsFromPayload(settings);
  if (durableObjectBindings.length) {
    throw new Error(`runtime deployment still has Durable Object bindings: ${durableObjectBindings.map((item) => item?.name || 'unknown').join(',')}`);
  }

  return {
    script: scriptName,
    previous_version_ids: [...previousVersionIds].sort(),
    active_version_ids: [...activeVersionIds].sort(),
    version_changed: changed,
    cron_triggers: 0,
    durable_object_bindings: 0,
  };
}
