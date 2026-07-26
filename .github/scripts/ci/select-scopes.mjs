import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STATIONHEAD_ALL = Object.freeze({
  pages: true,
  worker: true,
  sql: true,
  repository_full: true,
});

const HOMEPANEL_ALL = Object.freeze({
  cloud: true,
  video: true,
  bundle: true,
  contracts: true,
  integration: true,
  migrations: true,
});

function matches(file, pattern) {
  return pattern.test(file);
}

export function selectStationheadScopes(files, { all = false } = {}) {
  if (all) return { ...STATIONHEAD_ALL };

  const scopes = {
    pages: false,
    worker: false,
    sql: false,
    repository_full: false,
  };

  for (const file of files) {
    if (matches(file, /^(?:site|database|worker|packages\/sh-shared|scripts|tests)\//)
      || file === 'package.json') scopes.repository_full = true;
    if (matches(file, /^(?:site|packages\/sh-shared|database)\//)) scopes.pages = true;
    if (matches(file, /^(?:worker|packages\/sh-shared)\//)
      || matches(file, /^database\/facts-(?:migrations\/|[^/]+)/)) scopes.worker = true;
    if (matches(file, /^database\//) || file === 'tests/sql_migrations_test.py') scopes.sql = true;
    if (file === '.github/scripts/ci/select-scopes.mjs') Object.assign(scopes, STATIONHEAD_ALL);
  }

  return scopes;
}

export function selectHomePanelScopes(files, { all = false } = {}) {
  if (all) return { ...HOMEPANEL_ALL };

  const scopes = {
    cloud: false,
    video: false,
    bundle: false,
    contracts: false,
    integration: false,
    migrations: false,
  };

  for (const file of files) {
    if (/^hp\/package(?:-lock)?\.json$/.test(file)) {
      scopes.cloud = true;
      scopes.video = true;
      scopes.bundle = true;
    }
    if (file.startsWith('hp/cloud/')) scopes.cloud = true;
    if (/^hp\/video\/(?:src|public|test|scripts)\//.test(file)
      || ['hp/video/package.json', 'hp/video/wrangler.jsonc'].includes(file)) {
      scopes.video = true;
    }
    if (/^hp\/video\/(?:src|public)\//.test(file)
      || ['hp/video/package.json', 'hp/video/wrangler.jsonc'].includes(file)) scopes.bundle = true;
    if (/^hp\/cloud\/(?:package(?:-lock)?\.json|wrangler[^/]*\.jsonc)$/.test(file)
      || file === 'hp/cloud/src/unified_worker.js') scopes.bundle = true;
    if (/^hp\/cloud\/test\/.*\.integration\.test\.ts$/.test(file)) scopes.integration = true;
    if (/^hp\/cloud\/migrations\//.test(file)
      || ['hp/cloud/scripts/deploy-existing.mjs', 'hp/cloud/scripts/d1-import-utils.mjs', 'hp/cloud/wrangler.jsonc'].includes(file)) {
      scopes.migrations = true;
    }
    if (/^\.github\/actions\/cloudflare-/.test(file)
      || /^\.github\/scripts\//.test(file)
      || ['.github/workflows/cloud-deploy.yml', '.github/workflows/sh-observability.yml'].includes(file)
      || /^tests\/(?:cloudflare-|homepanel-|observability-)/.test(file)
      || file === 'tests/helpers/source-contract.mjs') scopes.contracts = true;
    if (['.github/workflows/homepanel-unified-ci.yml', '.github/scripts/ci/select-scopes.mjs'].includes(file)) {
      Object.assign(scopes, HOMEPANEL_ALL);
    }
  }

  return scopes;
}

function writeOutputs(scopes) {
  const output = `${Object.entries(scopes).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}

function main() {
  const [scope, ...flags] = process.argv.slice(2);
  const options = { all: flags.includes('--all') };
  const files = options.all
    ? []
    : readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean);

  if (scope === 'stationhead') writeOutputs(selectStationheadScopes(files, options));
  else if (scope === 'homepanel') writeOutputs(selectHomePanelScopes(files, options));
  else throw new Error(`Unknown CI scope: ${scope || '<missing>'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
