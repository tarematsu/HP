import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const entry = readFileSync(new URL('.github/scripts/audit-cloudflare-free-tier.py', root), 'utf8');
const storage = readFileSync(new URL('.github/scripts/cloudflare_d1_storage.py', root), 'utf8');

test('observability free-tier audit appends current D1 storage without making SQL queries', () => {
  assert.match(entry, /from cloudflare_d1_storage import append_d1_storage_diagnostics/);
  assert.match(entry, /append_d1_storage_diagnostics\(\)/);
  assert.match(storage, /\/d1\/database\/\{database_id\}\?\{query\}/);
  assert.match(storage, /urlencode\(\{"fields": "uuid,name,file_size"\}\)/);
  assert.match(storage, /file_size/);
  assert.match(storage, /### D1 database storage/);
  assert.match(storage, /Current configured D1 total/);
  assert.match(storage, /Available-size subtotal/);
  assert.match(storage, /full configured D1 total: \*\*unavailable\*\*/);
  assert.match(storage, /no SQL query executed/);
  assert.doesNotMatch(storage, /\/query[`"']/);
});

test('free-tier audit self-test covers complete, partial, and unavailable D1 size reporting', () => {
  const result = spawnSync('python3', ['.github/scripts/audit-cloudflare-free-tier.py', '--self-test'], {
    cwd: rootPath,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /D1 storage diagnostics self-test passed/);
});
