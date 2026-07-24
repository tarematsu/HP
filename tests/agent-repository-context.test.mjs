import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SH_CONFIGS = [
  'worker/wrangler.sakurazaka46jp.jsonc',
  'worker/wrangler.buddies-collector.jsonc',
  'worker/wrangler.runtime.jsonc',
];
const HP_CONFIGS = [
  'hp/cloud/wrangler.jsonc',
  'hp/video/wrangler.jsonc',
];

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('agent instructions pin the HP monorepo and active Cloudflare topology', async () => {
  const instructions = await source('AGENTS.md');
  assert.match(instructions, /canonical monorepo/);
  assert.match(instructions, /`tarematsu\/HP`/);
  assert.doesNotMatch(instructions, /repository is `tarematsu\/SH`/);
  assert.match(instructions, /local checkout path is not part of repository identity/);
  assert.match(instructions, /older conversation/);
  assert.match(instructions, /browser tab/);
  assert.match(instructions, /Stationhead: `worker\/`, `site\/`, `database\/`/);
  assert.match(instructions, /HomePanel Cloud: `hp\/cloud\/`/);
  assert.match(instructions, /HomePanel Video: `hp\/video\/`/);
  assert.match(instructions, /HomePanel Native: `hp\/native\/`/);

  for (const path of [...SH_CONFIGS, ...HP_CONFIGS]) {
    assert.match(instructions, new RegExp(path.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(instructions, /worker\/wrangler\.ingest\.jsonc/);
  assert.doesNotMatch(instructions, /worker\/wrangler\.minute-enrichment\.jsonc/);

  const configs = await Promise.all(SH_CONFIGS.map(source));
  const workerNames = configs.map((config) => JSON.parse(config).name);
  assert.deepEqual(workerNames, [
    'sh-sakurazaka46jp',
    'sh-buddies-collector',
    'sh-runtime-orchestrator',
  ]);

  const databaseNames = new Set(configs.flatMap((config) => (
    JSON.parse(config).d1_databases.map(({ database_name: name }) => name)
  )));
  assert.deepEqual([...databaseNames].sort(), [
    'stationhead-buddies',
    'stationhead-minute',
    'stationhead-other',
  ]);
});

test('agent instructions preserve deployment boundaries and metrics provenance', async () => {
  const instructions = await source('AGENTS.md');
  assert.match(instructions, /deploy-split-pipeline\.yml/);
  assert.match(instructions, /cloud-deploy\.yml/);
  assert.match(instructions, /actual, estimated, extrapolated, or unavailable/);
  assert.match(instructions, /measurement window and timestamp/);
  assert.match(instructions, /resource identity does not match the active configuration/);
  assert.match(instructions, /Never display tokens/);
  assert.match(instructions, /workflows declarative/);
  assert.match(instructions, /responsibility-specific files/);
});
