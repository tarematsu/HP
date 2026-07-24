import { readFile } from 'node:fs/promises';
import process from 'node:process';

const DEFAULT_ENV_FILE = '.env.cloudflare.local';
const API_BASE = 'https://api.cloudflare.com/client/v4';
const TARGET_KEYS = [
  'ADMIN_TOKEN',
  'PRODUCTION_D1_DATABASE_ID',
  'MEDIA_HOST',
  'SOURCE_A_URL',
  'SOURCE_B_URL',
  'SOURCE_C_URL',
  'SOURCE_D_URL',
  'SOURCE_E_URL'
];
const REQUIRED_KEYS = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_PROJECT_NAME'
];

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function parseEnv(content) {
  const values = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const equals = normalized.indexOf('=');
    if (equals <= 0) continue;
    const key = normalized.slice(0, equals).trim();
    let value = normalized.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function readEnvFile(path) {
  try {
    return parseEnv(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function mergedEnv(fileEnv) {
  return { ...fileEnv, ...process.env };
}

function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function envList(env) {
  return String(env.CLOUDFLARE_ENVIRONMENTS || 'production,preview')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value === 'production' || value === 'preview');
}

function secretVars(env) {
  const vars = {};
  for (const key of TARGET_KEYS) {
    const value = String(env[key] || '').trim();
    if (!value) continue;
    vars[key] = { type: 'secret_text', value };
  }
  return vars;
}

function validateSourceUrls(vars) {
  for (const key of TARGET_KEYS.filter((value) => value.startsWith('SOURCE_'))) {
    const value = vars[key]?.value;
    if (!value) continue;
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error(`${key} must use https`);
  }
}

async function cloudflareRequest(env, path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${required(env, 'CLOUDFLARE_API_TOKEN')}`,
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok || data.success === false) {
    const message = data.errors?.map((error) => error.message).join('; ')
      || data.messages?.map((item) => item.message).join('; ')
      || text
      || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function patchBody(environments, vars) {
  const deploymentConfigs = {};
  for (const environment of environments) {
    deploymentConfigs[environment] = { env_vars: vars };
  }
  return { deployment_configs: deploymentConfigs };
}

function printPlan(environments, vars) {
  console.log('Cloudflare Pages environment plan');
  console.log(`- environments: ${environments.join(', ')}`);
  for (const [key, value] of Object.entries(vars)) {
    console.log(`- set secret ${key}`);
  }
}

const envFile = argValue('--env-file', DEFAULT_ENV_FILE);
const fileEnv = await readEnvFile(envFile);
const env = mergedEnv(fileEnv);
for (const key of REQUIRED_KEYS) required(env, key);

const environments = envList(env);
if (!environments.length) throw new Error('CLOUDFLARE_ENVIRONMENTS must include production or preview');
const vars = secretVars(env);
validateSourceUrls(vars);
if (!Object.keys(vars).length) throw new Error('No variables to configure');

printPlan(environments, vars);
if (hasArg('--dry-run')) {
  console.log('Dry run only. No Cloudflare changes were made.');
  process.exit(0);
}

const accountId = encodeURIComponent(required(env, 'CLOUDFLARE_ACCOUNT_ID'));
const projectName = encodeURIComponent(required(env, 'CLOUDFLARE_PROJECT_NAME'));
const body = patchBody(environments, vars);
await cloudflareRequest(env, `/accounts/${accountId}/pages/projects/${projectName}`, {
  method: 'PATCH',
  body: JSON.stringify(body)
});
console.log('Cloudflare Pages environment variables updated.');
