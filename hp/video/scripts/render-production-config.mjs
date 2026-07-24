import { readFile, writeFile } from 'node:fs/promises';

import {
  DATABASE_ID_KEYS,
  DATABASE_NAME_KEYS,
  firstEnv,
  resolveD1Database
} from './cloudflare-d1.mjs';

const WORKER_NAME_KEYS = ['CLOUDFLARE_WORKER_NAME', 'WORKER_NAME'];
const DUMMY_DATABASE_ID = '00000000-0000-0000-0000-000000000000';
const PRODUCTION_CRONS = Object.freeze([
  '2 * * * *'
]);

function extractConfigValue(source, key) {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  return match?.[1] || '';
}

function syncProductionCrons(source) {
  const config = JSON.parse(source);
  config.triggers ||= {};
  config.triggers.crons = [...PRODUCTION_CRONS];
  return `${JSON.stringify(config, null, 2)}\n`;
}

const source = await readFile('wrangler.jsonc', 'utf8');
const workerName = firstEnv(WORKER_NAME_KEYS) || extractConfigValue(source, 'name') || 'video-scraper';
const configuredDatabaseName = extractConfigValue(source, 'database_name');
const database = await resolveD1Database(configuredDatabaseName);

if (!database?.id) {
  throw new Error(`Could not resolve D1 database. Set ${DATABASE_ID_KEYS.join(' or ')}, set ${DATABASE_NAME_KEYS.join(' or ')}, or allow wrangler d1 list / Cloudflare API access.`);
}

const rendered = syncProductionCrons(source)
  .replace(/"name"\s*:\s*"[^"]+"/, `"name": "${workerName}"`)
  .replace(/"database_name"\s*:\s*"[^"]+"/, `"database_name": "${database.name}"`)
  .replace(DUMMY_DATABASE_ID, database.id);

if (rendered.includes(DUMMY_DATABASE_ID)) {
  throw new Error('Failed to render production wrangler config from wrangler.jsonc');
}

await writeFile('wrangler.production.jsonc', rendered, 'utf8');
await writeFile('wrangler.jsonc', rendered, 'utf8');
console.log(`Rendered wrangler.production.jsonc and synced wrangler.jsonc for ${workerName} using D1 ${database.name} with crons ${PRODUCTION_CRONS.join(', ')}`);
