import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const packageJson = JSON.parse(read('../package.json'));
const workflow = read('../.github/workflows/sync-d1-id.yml');
const resolver = read('../scripts/cloudflare-d1.mjs');
const syncScript = read('../scripts/sync-d1-database-id.mjs');
const renderScript = read('../scripts/render-production-config.mjs');

test('Cloudflare build repairs a placeholder D1 ID during dependency installation', () => {
  assert.equal(
    packageJson.scripts.postinstall,
    'node scripts/sync-d1-database-id.mjs --if-placeholder'
  );
  assert.match(syncScript, /process\.argv\.includes\('--if-placeholder'\)/);
  assert.match(syncScript, /00000000-0000-0000-0000-000000000000/);
  assert.match(syncScript, /skipping install-time synchronization/);
  assert.match(syncScript, /concrete database ID/);
});

test('GitHub Actions resolves and commits the current D1 database ID', () => {
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /node scripts\/sync-d1-database-id\.mjs/);
  assert.match(workflow, /git add wrangler\.jsonc/);
  assert.match(workflow, /git push origin/);
  assert.match(workflow, /github\.actor != 'github-actions\[bot\]'/);
});

test('D1 resolver uses the repository Cloudflare token and API', () => {
  assert.match(resolver, /CLOUDFLARE_BUILDS_API_TOKEN/);
  assert.match(resolver, /\/accounts\?per_page=50/);
  assert.match(resolver, /\/d1\/database/);
  assert.match(resolver, /selectDatabase/);
});

test('D1 synchronization changes only the configured database binding', () => {
  assert.match(syncScript, /entry\?\.binding === 'DB'/);
  assert.match(syncScript, /binding\.database_id = database\.id/);
  assert.match(syncScript, /binding\.database_name = database\.name/);
  assert.match(syncScript, /writeFile\(configPath/);
});

test('production rendering reuses the same D1 resolver', () => {
  assert.match(renderScript, /resolveD1Database/);
  assert.match(renderScript, /\.replace\(DUMMY_DATABASE_ID, database\.id\)/);
});
