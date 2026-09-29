import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  spotifyArtistChartSql,
  spotifyPlaycountSql,
  spotifyReadModel,
  spotifyTrendSql,
} from '../../site/functions/api/spotify-playcounts.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const otherDatabase = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';

export const SPOTIFY_READ_MODEL_KEY = 'spotify-playcounts';
export const SPOTIFY_RENDERER_REVISION = 'spotify-event-v1';

const RESPONSE_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function wrangler(args, options = {}) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function remoteOtherDb() {
  return createWranglerRemoteD1({
    database: otherDatabase,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: '.spotify-read-model-bootstrap-',
  });
}

export async function loadSpotifyReadModelFromD1(db) {
  const [latestResult, trendResult, artistChartResult] = await Promise.all([
    db.prepare(spotifyPlaycountSql()).all(),
    db.prepare(spotifyTrendSql()).all(),
    db.prepare(spotifyArtistChartSql()).all(),
  ]);
  return spotifyReadModel(rows(latestResult), rows(trendResult), rows(artistChartResult));
}

export function spotifyBootstrapEnvelope(model, now = Date.now()) {
  const body = JSON.stringify({ ok: true, ...model });
  const sourceRevision = [
    'spotify-event',
    model.groups?.sakurazaka46?.snapshot_date ?? '',
    model.artist_chart?.latest_chart_date ?? '',
    model.artist_chart?.latest_observed_at ?? '',
  ].join(':');
  const updatedAt = Number(now);
  return {
    version: 1,
    status: 200,
    headers: RESPONSE_HEADERS,
    updated_at: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    cadence_seconds: 0,
    source_revision: sourceRevision,
    renderer_revision: SPOTIFY_RENDERER_REVISION,
    body,
  };
}

export function loadExistingSpotifyEnvelope() {
  const directory = mkdtempSync(join(workerRoot, '.spotify-read-model-existing-'));
  try {
    const path = join(directory, 'spotify-playcounts.json');
    const key = pagesActionsR2ResponseKey(SPOTIFY_READ_MODEL_KEY);
    try {
      wrangler([
        'r2', 'object', 'get', `${responseBucket}/${key}`,
        '--remote', '--file', path,
      ]);
    } catch {
      return null;
    }
    try {
      const envelope = JSON.parse(readFileSync(path, 'utf8'));
      return envelope && typeof envelope === 'object' && !Array.isArray(envelope)
        ? envelope
        : null;
    } catch {
      return null;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function uploadSpotifyEnvelope(envelope) {
  const directory = mkdtempSync(join(workerRoot, '.spotify-read-model-bootstrap-upload-'));
  try {
    const path = join(directory, 'spotify-playcounts.json');
    writeFileSync(path, JSON.stringify(envelope), 'utf8');
    const key = pagesActionsR2ResponseKey(SPOTIFY_READ_MODEL_KEY);
    wrangler([
      'r2', 'object', 'put', `${responseBucket}/${key}`,
      '--remote', '--file', path,
      '--content-type', 'application/json; charset=utf-8',
    ], { capture: false });
    return key;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function envelopeMatches(existing, next) {
  return Number(existing?.version) === 1
    && Number(existing?.status) === 200
    && existing?.body === next.body
    && existing?.source_revision === next.source_revision
    && existing?.renderer_revision === next.renderer_revision;
}

export async function bootstrapSpotifyReadModel(options = {}) {
  const db = options.db || remoteOtherDb();
  const loadModel = options.loadModel || loadSpotifyReadModelFromD1;
  const loadExisting = options.loadExistingEnvelope || loadExistingSpotifyEnvelope;
  const upload = options.uploadEnvelope || uploadSpotifyEnvelope;
  const model = await loadModel(db);
  const envelope = spotifyBootstrapEnvelope(model, options.now ?? Date.now());
  const existing = await loadExisting();

  if (envelopeMatches(existing, envelope)) {
    return {
      ok: true,
      event: 'spotify_read_model_bootstrap_complete',
      published: false,
      changed: false,
      object_key: null,
      source_revision: envelope.source_revision,
      snapshot_date: model.groups?.sakurazaka46?.snapshot_date ?? null,
      chart_date: model.artist_chart?.latest_chart_date ?? null,
    };
  }

  const objectKey = await upload(envelope);
  return {
    ok: true,
    event: 'spotify_read_model_bootstrap_complete',
    published: true,
    changed: true,
    object_key: objectKey,
    source_revision: envelope.source_revision,
    snapshot_date: model.groups?.sakurazaka46?.snapshot_date ?? null,
    chart_date: model.artist_chart?.latest_chart_date ?? null,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await bootstrapSpotifyReadModel()));
}
