import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('HomePanel deployment resolves workers.dev and requires public D1 health after every deploy', () => {
  const workflow = read('.github/workflows/cloud-deploy.yml');
  const resolver = read('.github/scripts/cloudflare-worker-public-url.mjs');
  const healthRoute = read('hp/video/src/entry.js');

  for (const fragment of [
    '.github/scripts/cloudflare-worker-public-url.mjs',
    'Resolve deployed HomePanel public URL',
    'id: homepanel-public-url',
    'cloudflare-worker-public-url.mjs homepanel-cloud /api/health',
    'name: Verify deployed readiness',
    'HOMEPANEL_HEALTH_URL: ${{ steps.homepanel-public-url.outputs.health-url }}',
    'payload?.ok !== true',
    'payload?.service !== "homepanel-video"',
    'name: Verify authenticated deployed readiness',
    'HOMEPANEL_BASE_URL: ${{ steps.homepanel-public-url.outputs.base-url }}',
    'Public HomePanel D1 health passed',
  ]) assert.match(workflow, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.doesNotMatch(workflow, /HOMEPANEL_BASE_URL: \$\{\{ vars\.HOMEPANEL_BASE_URL \}\}/);
  assert.doesNotMatch(workflow, /Set HOMEPANEL_BASE_URL variable/);
  assert.ok(
    workflow.indexOf('- name: Deploy HomePanel Cloud')
      < workflow.indexOf('- name: Resolve deployed HomePanel public URL'),
  );
  assert.ok(
    workflow.indexOf('- name: Resolve deployed HomePanel public URL')
      < workflow.indexOf('- name: Verify deployed readiness'),
  );

  assert.match(resolver, /workers\/subdomain/);
  assert.match(resolver, /workers\/scripts\/\$\{encodedWorker\}\/subdomain/);
  assert.match(resolver, /not enabled on workers\.dev/);
  assert.match(healthRoute, /SELECT 1 AS ok/);
  assert.match(healthRoute, /pathname === '\/api\/health'/);
});
