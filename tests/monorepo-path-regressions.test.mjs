import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('HomePanel production workflows use monorepo paths', () => {
  const observability = read('.github/workflows/hp-observability.yml');
  const insights = read('.github/scripts/query-cloudflare-d1-insights.mjs');

  assert.match(observability, /npm ci --prefix hp\/cloud/);
  assert.doesNotMatch(observability, /npm ci --prefix cloud(?:\s|$)/);
  assert.match(insights, /hp\\\\cloud\\\\node_modules\\\\\.bin\\\\wrangler\.cmd/);
  assert.match(insights, /hp\/cloud\/node_modules\/\.bin\/wrangler/);
});

test('root HomePanel helper scripts target hp/native', () => {
  const build = read('build.bat');
  const register = read('register-homepanel-startup-task.ps1');

  assert.match(build, /cmake -S hp\/native -B hp\/native\/build-local/);
  assert.match(build, /cmake --build hp\/native\/build-local/);
  assert.match(build, /hp\\native\\build-local\\Release/);
  assert.doesNotMatch(build, /cmake -S native(?:\s|\/)/);
  assert.match(register, /hp\\native\\scripts\\register-task\.ps1/);
});

test('gitignore excludes HomePanel build outputs at their monorepo locations', () => {
  const ignore = read('.gitignore');
  for (const path of [
    'hp/native/build/',
    'hp/native/build-*/',
    'hp/native/build-ci/',
    'hp/native/packages/',
    'hp/native/data/',
    'hp/cloud/node_modules/',
    'hp/cloud/.wrangler/',
    'hp/cloud/dist/',
  ]) {
    assert.match(ignore, new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), path);
  }
});
