import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('HomePanel deployment resolves workers.dev and requires public and authenticated readiness after every deploy', () => {
  const workflow = read('.github/workflows/cloud-deploy.yml');
  const resolver = read('.github/scripts/cloudflare-worker-public-url.mjs');
  const healthRoute = read('hp/video/src/entry.js');
  const auth = read('hp/cloud/src/auth.ts');
  const worker = read('hp/cloud/src/worker_core.ts');
  for (const fragment of [
    '.github/scripts/cloudflare-worker-public-url.mjs', 'Resolve deployed HomePanel public URL', 'id: homepanel-public-url',
    'cloudflare-worker-public-url.mjs homepanel-cloud /api/health',
    'RADAR_DISPATCH_TOKEN: ${{ secrets.RADAR_DISPATCH_TOKEN || secrets.GITHUB_RADAR_DISPATCH_TOKEN }}',
    'name: Sync radar dispatcher token', 'wrangler secret put GITHUB_RADAR_DISPATCH_TOKEN --name homepanel-cloud',
    'name: Verify deployed readiness', 'HOMEPANEL_HEALTH_URL: ${{ steps.homepanel-public-url.outputs.health-url }}',
    '--output "$output" --write-out "%{http_code}"', 'homepanel-public-health.status', 'homepanel-readiness.status',
    "printf 'curl_status=%s\\nhttp_status=%s\\n'", 'cat "$output" || true', 'payload?.ok!==true',
    'payload?.service!=="homepanel-video"', 'Unexpected HomePanel public health response (HTTP ${status})',
    'name: Verify authenticated deployed readiness', 'HOMEPANEL_BASE_URL: ${{ steps.homepanel-public-url.outputs.base-url }}',
    'Existing RADAR_DISPATCH_TOKEN is required for /v1/ready verification', 'Authorization: Bearer $RADAR_DISPATCH_TOKEN',
    '$HOMEPANEL_BASE_URL/v1/ready', 'payload?.service!=="homepanel-cloud"', 'checks.some(check=>check?.ok!==true)',
    'Unexpected HomePanel readiness response (HTTP ${status})', 'name: Upload HomePanel readiness diagnostics',
    'if: failure()', 'homepanel-readiness-diagnostics-${{ github.run_id }}', '${{ runner.temp }}/homepanel-public-health.json',
    '${{ runner.temp }}/homepanel-readiness.json',
  ]) assert.match(workflow.replace(/\s+/g, ''), new RegExp(fragment.replace(/\s+/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(workflow, /Verify GitHub repository dispatch credential/);
  assert.doesNotMatch(workflow, /homepanel-dispatch-credential-check/);
  assert.doesNotMatch(workflow, /curl --fail/);
  assert.doesNotMatch(workflow, /HOMEPANEL_READY_TOKEN|HOMEPANEL_API_TOKEN|secrets\.API_TOKEN/);
  assert.ok(workflow.indexOf('- name: Deploy HomePanel Cloud') < workflow.indexOf('- name: Sync radar dispatcher token'));
  assert.ok(workflow.indexOf('- name: Sync radar dispatcher token') < workflow.indexOf('- name: Resolve deployed HomePanel public URL'));
  assert.ok(workflow.indexOf('- name: Resolve deployed HomePanel public URL') < workflow.indexOf('- name: Verify deployed readiness'));
  assert.ok(workflow.indexOf('- name: Verify deployed readiness') < workflow.indexOf('- name: Verify authenticated deployed readiness'));
  assert.match(auth, /readinessSecrets\(env: Env\)/);
  assert.match(auth, /env\.GITHUB_RADAR_DISPATCH_TOKEN/);
  assert.match(auth, /authorizedReadiness\(request: Request, env: Env\)/);
  assert.match(worker, /authorizedReadiness/);
  assert.match(worker, /if \(!authorizedReadiness\(request, env\)\) return unauthorized\(\)/);
  assert.match(resolver, /workers\/subdomain/);
  assert.match(resolver, /workers\/scripts\/\$\{encodedWorker\}\/subdomain/);
  assert.match(resolver, /not enabled on workers\.dev/);
  assert.match(healthRoute, /SELECT 1 AS ok/);
  assert.match(healthRoute, /pathname === '\/api\/health'/);
});
