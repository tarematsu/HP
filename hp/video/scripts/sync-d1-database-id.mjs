import { readFile, writeFile } from 'node:fs/promises';

import { resolveD1Database } from './cloudflare-d1.mjs';

const configPath = 'wrangler.jsonc';
const DUMMY_DATABASE_ID = '00000000-0000-0000-0000-000000000000';
const placeholderOnly = process.argv.includes('--if-placeholder');

function isPlaceholderDatabaseId(value) {
  const id = String(value || '').trim();
  return !id || id === DUMMY_DATABASE_ID;
}

const source = await readFile(configPath, 'utf8');
const config = JSON.parse(source);
const bindings = Array.isArray(config.d1_databases) ? config.d1_databases : [];
const binding = bindings.find((entry) => entry?.binding === 'DB') || bindings[0];

if (!binding) throw new Error('wrangler.jsonc has no D1 database binding.');

if (placeholderOnly && !isPlaceholderDatabaseId(binding.database_id)) {
  console.log(`${configPath} already has a concrete D1 database ID; skipping install-time synchronization.`);
  process.exit(0);
}

const database = await resolveD1Database(String(binding.database_name || '').trim());
if (!database?.id || isPlaceholderDatabaseId(database.id)) {
  throw new Error('Cloudflare D1 database could not be resolved to a concrete database ID.');
}

const changed = binding.database_id !== database.id || binding.database_name !== database.name;
binding.database_id = database.id;
binding.database_name = database.name;

if (changed) {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`Updated ${configPath} with D1 ${database.name} (${database.id}).`);
} else {
  console.log(`${configPath} already references D1 ${database.name} (${database.id}).`);
}
