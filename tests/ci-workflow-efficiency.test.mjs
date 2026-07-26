import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function workflow(name) {
  return readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
}

function jobSection(source, name, nextName) {
  const start = source.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `${name} job must exist`);
  const end = nextName ? source.indexOf(`  ${nextName}:\n`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} job must exist after ${name}`);
  return source.slice(start, end);
}

const ci = workflow('ci.yml');
const homePanelCi = workflow('homepanel-unified-ci.yml');
const videoCi = workflow('video-ci.yml');
const nativeBuild = workflow('native-windows-build.yml');
const productionDeploy = workflow('deploy-split-pipeline.yml');
const d1Usage = workflow('fetch-cloudflare-d1-usage.yml');
const observability = workflow('sh-observability.yml');
const sitePackage = JSON.parse(readFileSync(new URL('../site/package.json', import.meta.url), 'utf8'));
const homePanelPackage = JSON.parse(
  readFileSync(new URL('../hp/cloud/package.json', import.meta.url), 'utf8'),
);
const workerDependencyGuard = readFileSync(
  new URL('../site/scripts/ensure-worker-test-deps.mjs', import.meta.url),
  'utf8',
);

test('CI selects affected scopes and keeps repository checks free of Pages dependencies', () => {
  assert.match(ci, /^  changes:\n/m);
  assert.match(ci, /needs\.changes\.outputs\.pages == 'true'/);
  assert.match(ci, /needs\.changes\.outputs\.worker == 'true'/);
  assert.match(ci, /needs\.changes\.outputs\.sql == 'true'/);
  assert.match(ci, /needs\.changes\.outputs\.repository_full == 'true'/);
  assert.match(ci, /Run CI workflow contract/);
  assert.doesNotMatch(ci, /\.github\/workflows\/ci\.yml\|\.github\/actions\/\*/);

  const repository = jobSection(ci, 'repository', 'pages');
  assert.match(repository, /uses: actions\/cache@v4/);
  assert.match(repository, /worker\/node_modules/);
  assert.match(repository, /npm ci --prefer-offline/);
  assert.doesNotMatch(repository, /site\/node_modules/);
  assert.doesNotMatch(repository, /working-directory: site/);
  assert.match(repository, /check-js-syntax\.mjs scripts tests \.github\/scripts\/ci/);
});

test('CI restores workspace dependencies and keeps expensive D1 checks manual-only', () => {
  const pages = jobSection(ci, 'pages', 'worker');
  const worker = jobSection(ci, 'worker', 'audit');

  assert.match(pages, /uses: actions\/cache@v4/);
  assert.match(pages, /site\/node_modules/);
  assert.match(pages, /worker\/node_modules/);
  assert.match(pages, /node --test tests\/\*\.test\.js/);
  assert.doesNotMatch(pages, /npm run test:integration/);
  assert.match(pages, /cache-hit != 'true'/);
  assert.match(pages, /if: github\.event_name == 'workflow_dispatch'\n        run: npm run test:d1/);
  assert.match(pages, /if: github\.event_name == 'workflow_dispatch'\n        run: npm run db:migrate/);

  assert.match(worker, /uses: actions\/cache@v4/);
  assert.match(worker, /worker\/node_modules/);
  assert.match(worker, /cache-hit != 'true'/);
});

test('CI trigger paths stay inside the Stationhead boundary', () => {
  const trigger = ci.slice(0, ci.indexOf('\npermissions:'));
  assert.match(trigger, /packages\/sh-shared\/\*\*/);
  assert.match(trigger, /scripts\/cloudflare-d1-\*\.mjs/);
  assert.match(trigger, /scripts\/validate-monorepo\.mjs/);
  assert.doesNotMatch(trigger, /scripts\/\*\*/);
  assert.doesNotMatch(trigger, /scripts\/local-release\.ps1/);
  assert.match(trigger, /!tests\/cloudflare-\*\.test\.mjs/);
  assert.match(trigger, /!tests\/homepanel-\*\.test\.mjs/);
  assert.match(trigger, /!tests\/observability-\*\.test\.mjs/);
  assert.match(trigger, /!tests\/helpers\/source-contract\.mjs/);
  assert.match(trigger, /\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(trigger, /\.github\/workflows\/\*\*/);
  assert.doesNotMatch(trigger, /\.github\/actions\/\*\*/);
  assert.doesNotMatch(trigger, /\.github\/scripts\/\*\*/);
  assert.doesNotMatch(trigger, /hp\/\*\*/);
});

test('HomePanel CI selects folder-scoped checks and keeps full validation off the PR path', () => {
  const trigger = homePanelCi.slice(0, homePanelCi.indexOf('\npermissions:'));
  assert.match(trigger, /hp\/cloud\/src\/\*\*/);
  assert.match(trigger, /hp\/cloud\/test\/\*\*/);
  assert.match(trigger, /hp\/video\/src\/\*\*/);
  assert.match(trigger, /tests\/cloudflare-\*\.test\.mjs/);
  assert.doesNotMatch(trigger, /hp\/cloud\/\*\*/);
  assert.doesNotMatch(trigger, /^  push:\n/m);

  assert.match(homePanelCi, /^  changes:\n/m);
  assert.match(homePanelCi, /needs\.changes\.outputs\.cloud == 'true'/);
  assert.match(homePanelCi, /needs\.changes\.outputs\.video == 'true'/);
  assert.match(homePanelCi, /needs\.changes\.outputs\.bundle == 'true'/);
  assert.match(homePanelCi, /needs\.changes\.outputs\.contracts == 'true'/);
  assert.match(homePanelCi, /needs\.changes\.outputs\.integration == 'true'/);
  assert.match(homePanelCi, /needs\.changes\.outputs\.migrations == 'true'/);
  assert.match(homePanelCi, /\.github\/scripts\/ci\/select-scopes\.mjs homepanel/);
  assert.match(homePanelCi, /npm run test:ci/);
  assert.match(homePanelCi, /github\.event_name == 'workflow_dispatch'/);
  assert.equal(
    homePanelPackage.scripts['test:ci'],
    "vitest run --exclude='test/**/*.integration.test.ts' --reporter=dot",
  );
});

test('Video CI ignores documentation-only changes', () => {
  const trigger = videoCi.slice(0, videoCi.indexOf('\npermissions:'));
  assert.match(trigger, /hp\/video\/src\/\*\*/);
  assert.match(trigger, /hp\/video\/public\/\*\*/);
  assert.match(trigger, /hp\/video\/migrations\/\*\*/);
  assert.match(trigger, /hp\/video\/test\/\*\*/);
  assert.match(trigger, /hp\/video\/scripts\/\*\*/);
  assert.doesNotMatch(trigger, /hp\/video\/\*\*/);
});

test('Native main releases queue without pending-run replacement', () => {
  assert.match(
    nativeBuild,
    /group: native-windows-\$\{\{ github\.event_name == 'pull_request' && github\.run_id \|\| github\.ref \}\}/,
  );
  assert.match(nativeBuild, /queue: max/);
  assert.doesNotMatch(nativeBuild, /cancel-in-progress:/);
  assert.match(nativeBuild, /- name: Upload update assets to R2/);
  assert.match(nativeBuild, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(nativeBuild, /updates\/latest\/update-manifest\.json/);
});

test('Pages builds reuse Worker integration dependencies when inputs are unchanged', () => {
  assert.equal(
    sitePackage.scripts['pretest:integration'],
    'node scripts/ensure-worker-test-deps.mjs',
  );
  assert.match(workerDependencyGuard, /\.sh-worker-deps\.sha256/);
  assert.match(workerDependencyGuard, /package-lock\.json/);
  assert.match(workerDependencyGuard, /packages\/sh-shared/);
  assert.match(workerDependencyGuard, /Reusing cached Worker integration dependencies/);
  assert.match(workerDependencyGuard, /'ci', '--prefer-offline'/);
});

test('the single production deployment workflow caches Pages and Worker dependencies', () => {
  assert.match(productionDeploy, /^  push:\n/m);
  assert.match(productionDeploy, /^  workflow_dispatch:\n/m);
  assert.doesNotMatch(productionDeploy, /^  pull_request:\n/m);
  assert.match(productionDeploy, /uses: actions\/cache@v4/);
  assert.match(productionDeploy, /worker\/node_modules/);
  assert.match(productionDeploy, /worker-deploy-/);
  assert.match(productionDeploy, /site\/node_modules/);
  assert.match(productionDeploy, /pages-deploy-/);
  assert.match(productionDeploy, /npm ci --prefer-offline/);
});

test('D1 query insights are manual-only and avoid installing Wrangler', () => {
  assert.match(d1Usage, /^  workflow_dispatch:\n/m);
  assert.doesNotMatch(d1Usage, /^  pull_request:\n/m);
  assert.doesNotMatch(d1Usage, /^  schedule:\n/m);
  assert.match(d1Usage, /query-cloudflare-d1-costs\.py/);
  assert.doesNotMatch(d1Usage, /worker-insights-|wrangler d1 insights|npm ci/);
  assert.doesNotMatch(d1Usage, /sleep ["']?\$|Waiting for the current PR deployment/);
});

test('unified Cloudflare observability runs after either deploy and daily at 01:00 UTC', () => {
  assert.match(observability, /^  workflow_run:\n/m);
  assert.match(observability, /workflows: \["Deploy production", "Deploy HomePanel Cloud services"\]/);
  assert.match(observability, /^  push:\n/m);
  assert.match(observability, /branches: \[main\]/);
  assert.match(observability, /\.github\/workflows\/sh-observability\.yml/);
  assert.match(observability, /\.github\/actions\/cloudflare-observability-diagnostics\/action\.yml/);
  assert.match(observability, /\.github\/scripts\/publish-cloudflare-observability-status\.mjs/);
  assert.doesNotMatch(observability, /^      - '(?:worker|site|packages)\//m);
  assert.match(observability, /^  classify:\n/m);
  assert.match(observability, /Defer deploy-affecting pushes to workflow_run/);
  assert.match(observability, /needs\.classify\.outputs\.run == 'true'/);
  assert.match(observability, /Deferring unified Cloudflare diagnostics until production deployment completes/);
  assert.match(observability, /^  schedule:\n/m);
  assert.match(observability, /cron: "0 1 \* \* \*"/);
  assert.equal((observability.match(/- cron:/g) || []).length, 1);
  assert.doesNotMatch(observability, /cron: "37 \* \* \* \*"/);
  assert.doesNotMatch(observability, /^  pull_request:\n/m);
  assert.match(observability, /secrets\.CLOUDFLARE_BUILDS_API_TOKEN/);
  assert.match(observability, /audit-cloudflare-daily-usage\.py/);
  assert.match(observability, /audit-cloudflare-free-tier\.py/);
  assert.match(observability, /audit-observability-budget-gates\.py/);
  assert.match(observability, /DAILY_REQUEST_BUDGET: "100000"/);
  assert.match(observability, /DAILY_D1_READ_BUDGET: "5000000"/);
  assert.match(observability, /DAILY_D1_WRITE_BUDGET: "100000"/);
  assert.match(observability, /DAILY_QUEUE_BUDGET: "10000"/);
  assert.match(observability, /query-cloudflare-observability\.py/);
  assert.match(observability, /query-cloudflare-d1-costs\.py/);
  assert.match(observability, /audit-deployed-cloudflare-telemetry\.py/);
  assert.match(observability, /LIVE_TAIL_LOG: live-tail\.log/);
  assert.doesNotMatch(observability, /audit-cloudflare-live-tail\.py/);
  assert.match(observability, /uses: \.\/\.github\/actions\/cloudflare-observability-diagnostics/);
  assert.match(observability, /live-tail-worker: sh-runtime-orchestrator/);
  assert.match(observability, /live-tail-seconds: "90"/);
  assert.match(observability, /id: daily-budget/);
  assert.match(observability, /id: free-tier-budget/);
  assert.match(observability, /id: budget-contract/);
  assert.match(observability, /id: d1-insights/);
  assert.match(observability, /id: observability-query/);
  assert.match(observability, /id: telemetry-policy/);
  assert.match(observability, /continue-on-error: true/);
  assert.match(observability, /steps\.daily-budget\.outcome == 'failure'/);
  assert.match(observability, /steps\.free-tier-budget\.outcome == 'failure'/);
  assert.match(observability, /steps\.budget-contract\.outcome == 'failure'/);
  assert.match(observability, /steps\.d1-insights\.outcome == 'failure'/);
  assert.match(observability, /steps\.observability-query\.outputs\.query-outcome == 'failure'/);
  assert.match(observability, /steps\.observability-query\.outputs\.public-health-outcome == 'failure'/);
  assert.match(observability, /steps\.telemetry-policy\.outcome == 'failure'/);
  assert.doesNotMatch(observability, /R2_BUCKET|AWS_ACCESS_KEY_ID|aws s3api/);
  assert.match(observability, /Upload sanitized observability report/);
  assert.match(observability, /if: always\(\)/);
  assert.match(observability, /retention-days: 1/);
  assert.doesNotMatch(observability, /observability-logs\/|raw\/|\.ndjson/);
});
