import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  pagesActionsR2ResponseKey,
  pagesActionsRawMetadataR2ResponseKey,
  pagesActionsRawR2ResponseKey,
} from '../src/pages-response-r2.js';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';

export const RAW_ACTIONS_MODEL_KEYS = Object.freeze([
  'history:daily',
  'history:weekly',
  'track-history-status',
]);

function wrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function sourceEtag(envelopeText) {
  return createHash('md5').update(envelopeText).digest('hex');
}

export function rawMetadataForEnvelope(envelope, etag) {
  return {
    version: '1',
    source_etag: etag,
    status: String(Number(envelope?.status) || 200),
    headers_uri: encodeURIComponent(JSON.stringify(envelope?.headers || {})),
    updated_at: String(Number(envelope?.updated_at) || Date.now()),
    cadence_seconds: String(Math.max(0, Number(envelope?.cadence_seconds) || 0)),
  };
}

export function seedRawActionsModel(modelKey, dependencies = {}) {
  const getObject = dependencies.getObject || ((key, path) => wrangler([
    'r2', 'object', 'get', `${responseBucket}/${key}`,
    '--remote', '--file', path,
  ]));
  const putObject = dependencies.putObject || ((key, path) => wrangler([
    'r2', 'object', 'put', `${responseBucket}/${key}`,
    '--remote', '--file', path,
    '--content-type', 'application/json; charset=utf-8',
  ], { capture: false }));

  const sourceKey = pagesActionsR2ResponseKey(modelKey);
  const rawKey = pagesActionsRawR2ResponseKey(modelKey);
  const metadataKey = pagesActionsRawMetadataR2ResponseKey(modelKey);
  if (!sourceKey || !rawKey || !metadataKey) throw new Error(`invalid pages read-model key: ${modelKey}`);

  const directory = mkdtempSync(join(workerRoot, '.pages-actions-raw-'));
  try {
    const sourcePath = join(directory, 'source.json');
    const rawPath = join(directory, 'raw.json');
    const metadataPath = join(directory, 'metadata.json');
    getObject(sourceKey, sourcePath);
    const envelopeText = readFileSync(sourcePath, 'utf8');
    const envelope = JSON.parse(envelopeText);
    if (Number(envelope?.version) !== 1 || Number(envelope?.status || 200) !== 200 || typeof envelope?.body !== 'string') {
      throw new Error(`unsupported pages Actions envelope for ${modelKey}`);
    }
    JSON.parse(envelope.body);
    const etag = sourceEtag(envelopeText);
    const metadata = rawMetadataForEnvelope(envelope, etag);
    writeFileSync(rawPath, envelope.body, 'utf8');
    writeFileSync(metadataPath, JSON.stringify(metadata), 'utf8');
    putObject(rawKey, rawPath);
    putObject(metadataKey, metadataPath);
    return {
      key: modelKey,
      source_key: sourceKey,
      raw_key: rawKey,
      metadata_key: metadataKey,
      bytes: envelope.body.length,
      source_etag: etag,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function seedRawActionsModels(keys = RAW_ACTIONS_MODEL_KEYS, dependencies = {}) {
  return keys.map((key) => seedRawActionsModel(key, dependencies));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ ok: true, seeded: seedRawActionsModels() }));
}
