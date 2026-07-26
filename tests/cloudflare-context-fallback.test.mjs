import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const action = readFileSync(new URL('.github/actions/cloudflare-context/action.yml', root), 'utf8');
const workflows = [
  '.github/workflows/database.yml',
  '.github/workflows/run-pages-read-model-rebuild.yml',
  '.github/workflows/run-runtime-offline-maintenance.yml',
  '.github/workflows/run-track-metadata-repair.yml',
].map((path) => readFileSync(new URL(path, root), 'utf8'));

const TOKEN_FALLBACK = 'secrets.CLOUDFLARE_API_TOKEN || secrets.CLOUDFLARE_BUILDS_API_TOKEN || secrets.CF_API_TOKEN';

test('Cloudflare context action accepts the resolved job token when a named input is empty', () => {
  assert.match(action, /required: false/);
  assert.match(action, /inputs\.api-token \|\| env\.CLOUDFLARE_API_TOKEN \|\| env\.CLOUDFLARE_BUILDS_API_TOKEN/);
  assert.match(action, /inputs\.account-id \|\| env\.CLOUDFLARE_ACCOUNT_ID/);
});

test('scheduled and reusable database workflows expose the same Cloudflare token fallback', () => {
  for (const workflow of workflows) {
    assert.equal(workflow.includes(TOKEN_FALLBACK), true);
    assert.match(workflow, /uses: \.\/\.github\/actions\/cloudflare-context/);
  }
});
