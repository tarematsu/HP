#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'wrangler.jsonc');
const sqlPath = resolve(root, 'pipelines/homepanel-events.sql');
const streamName = 'homepanel_events_stream';
const sinkName = 'homepanel_events_sink';
const pipelineName = 'homepanel_events';
const bucketName = process.env.HOMEPANEL_PIPELINE_BUCKET || process.argv[2];

if (!bucketName) {
  console.error('Usage: HOMEPANEL_PIPELINE_BUCKET=<r2-bucket-name> node scripts/setup-homepanel-pipeline.mjs');
  process.exit(2);
}

function wrangler(args, options = {}) {
  const result = spawnSync('npx', ['wrangler', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')} failed with status ${result.status}`);
  }
  return result;
}

function getJson(kind, name) {
  const result = wrangler(['pipelines', ...kind, 'get', name, '--json'], {
    capture: true,
    allowFailure: true
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Could not parse wrangler JSON for ${name}`);
  }
}

function resourceId(value) {
  if (!value || typeof value !== 'object') return '';
  const direct = value.id || value.stream_id || value.streamId;
  if (typeof direct === 'string' && direct) return direct;
  for (const nested of Object.values(value)) {
    const found = resourceId(nested);
    if (found) return found;
  }
  return '';
}

let stream = getJson(['streams'], streamName);
if (!stream) {
  wrangler(['pipelines', 'streams', 'create', streamName]);
  stream = getJson(['streams'], streamName);
}
const streamId = resourceId(stream);
if (!streamId) throw new Error(`Could not resolve stream ID for ${streamName}`);

if (!getJson(['sinks'], sinkName)) {
  wrangler([
    'pipelines', 'sinks', 'create', sinkName,
    '--type', 'r2',
    '--bucket', bucketName,
    '--format', 'parquet',
    '--compression', 'zstd',
    '--path', 'homepanel/events',
    '--partitioning', 'year=%Y/month=%m/day=%d/hour=%H'
  ]);
}

if (!getJson([], pipelineName)) {
  wrangler(['pipelines', 'create', pipelineName, '--sql-file', sqlPath]);
}

const source = readFileSync(configPath, 'utf8');
const config = JSON.parse(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
config.pipelines = [{ binding: 'HOMEPANEL_PIPELINE', stream: streamId }];
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Configured HOMEPANEL_PIPELINE -> ${streamId}`);
console.log('Run npx wrangler deploy after reviewing wrangler.jsonc.');
