import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
for (const path of ['worker', 'site', 'database', 'hp/cloud', 'hp/video', 'hp/native']) {
  assert.equal(existsSync(resolve(root, path)), true, `missing ${path}`);
}
assert.equal(existsSync(resolve(root, 'SH')), false, 'legacy SH directory must be removed');
for (const path of ['cloud', 'video', 'native']) {
  assert.equal(existsSync(resolve(root, path)), false, `legacy HP path remains: ${path}`);
}
const workflows = resolve(root, '.github/workflows');
for (const name of ['deploy-split-pipeline.yml', 'database.yml', 'sh-observability.yml', 'cloud-deploy.yml', 'hp-observability.yml']) {
  assert.equal(existsSync(resolve(workflows, name)), true, `missing workflow ${name}`);
}
for (const name of readdirSync(workflows).filter((name) => name.endsWith('.yml'))) {
  const source = readFileSync(resolve(workflows, name), 'utf8');
  assert.doesNotMatch(source, /CLOUDFLARE_ACCOUNT_ID:\s*['"]?[0-9a-f]{32}/i, name);
}
console.log('monorepo layout validated');
