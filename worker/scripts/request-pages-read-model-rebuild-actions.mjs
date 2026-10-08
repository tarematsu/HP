import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export const RECOVERY_MODEL_KEYS = Object.freeze([
  'history:daily',
  'history:weekly',
  'history:broadcasts',
  'host-history:summary',
]);

function requestedKeys(raw = process.env.PAGES_READ_MODEL_DUE_KEYS || '') {
  const text = String(raw).trim();
  if (!text) return [...RECOVERY_MODEL_KEYS];
  const allowed = new Set(RECOVERY_MODEL_KEYS);
  const keys = [...new Set(text.split(',').map((value) => value.trim()).filter(Boolean))];
  const invalid = keys.filter((key) => !allowed.has(key));
  if (invalid.length) throw new Error(`unsupported read-model keys: ${invalid.join(', ')}`);
  return keys;
}

function sqlFor(keys) {
  return keys.map((key) => `INSERT INTO sh_read_model_revision(model_key,revision,updated_at)
VALUES('${key}',1,unixepoch()*1000)
ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;`).join('\n');
}

export function requestPagesReadModelRebuild({ rawKeys, run = execFileSync } = {}) {
  const keys = requestedKeys(rawKeys);
  if (!keys.length) return { requested: 0, keys: [] };
  const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
  run(process.execPath, [wrangler, 'd1', 'execute', process.env.OTHER_DATABASE_NAME || 'stationhead-other', '--remote', '--command', sqlFor(keys)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return { requested: keys.length, keys };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(requestPagesReadModelRebuild()));
}
