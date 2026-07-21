import { readFileSync } from 'node:fs';

const [homepanelListPath, videoListPath, payloadPath] = process.argv.slice(2);
if (!homepanelListPath || !videoListPath || !payloadPath) {
  throw new Error('Usage: validate-cutover-secrets.mjs <homepanel-list.json> <video-list.json> <payload.json>');
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function secretNames(payload) {
  const entries = Array.isArray(payload) ? payload : payload?.result;
  if (!Array.isArray(entries)) throw new Error('Wrangler secret list did not return an array');
  return entries
    .map((entry) => String(entry?.name || '').trim())
    .filter(Boolean);
}

const homepanelNames = secretNames(readJson(homepanelListPath, 'homepanel-cloud secret list'));
const videoNames = secretNames(readJson(videoListPath, 'videoscraper secret list'));
const secretPayload = readJson(payloadPath, 'HOMEPANEL_RUNTIME_SECRETS_JSON');
if (!secretPayload || typeof secretPayload !== 'object' || Array.isArray(secretPayload)) {
  throw new Error('HOMEPANEL_RUNTIME_SECRETS_JSON must be a JSON object of secret-name to value');
}

const payloadNames = new Set(
  Object.entries(secretPayload)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([name]) => name)
);
const legacyNames = [...new Set([...homepanelNames, ...videoNames])].sort();
const missing = legacyNames.filter((name) => !payloadNames.has(name));
if (missing.length) {
  throw new Error(`Secret payload does not cover the legacy Workers: ${missing.join(', ')}`);
}
if (!payloadNames.has('ADMIN_TOKEN')) {
  throw new Error('Secret payload must include ADMIN_TOKEN for the video application');
}
if (![...payloadNames].some((name) => [
  'HOMEPANEL_DEVICE_TOKENS',
  'HOMEPANEL_INGEST_SECRET',
  'DEVICE_TOKEN'
].includes(name))) {
  throw new Error('Secret payload must include a HomePanel device authentication secret');
}

console.log(JSON.stringify({
  legacyHomepanelSecrets: homepanelNames.sort(),
  legacyVideoSecrets: videoNames.sort(),
  unifiedSecretCount: payloadNames.size,
  coverage: 'complete'
}, null, 2));
