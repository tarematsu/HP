import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  bootstrapSpotifyReadModel,
  SPOTIFY_RENDERER_REVISION,
  spotifyBootstrapEnvelope,
} from '../scripts/bootstrap-spotify-read-model.mjs';

const deployScript = readFileSync(
  new URL('../scripts/deploy-spotify-playcount.mjs', import.meta.url),
  'utf8',
);

function model(snapshotDate = '2026-09-29') {
  return {
    default_artist: 'sakurazaka46',
    groups: {
      sakurazaka46: {
        artist: { key: 'sakurazaka46', name: '櫻坂46' },
        snapshot_date: snapshotDate,
        carried_forward: false,
        track_count: 1,
        total_delta: 123,
        tracks: [],
      },
    },
    trend: {},
    artist_chart: {
      chart_id: 'artist-jp-daily',
      latest_chart_date: '2026-09-29',
      latest_observed_at: 1790636400000,
      days: [],
    },
    monthly_listener_rows: [{
      snapshot_date: snapshotDate,
      artist_key: 'sakurazaka46',
      artist_name: '櫻坂46',
      monthly_listeners: 345678,
      collected_at: 1790636500000,
      current_rank: 1,
    }],
  };
}

test('Spotify deploy bootstrap skips R2 writes when D1 and R2 already match', async () => {
  const current = model();
  const existing = spotifyBootstrapEnvelope(current, 1000);
  let uploads = 0;

  const result = await bootstrapSpotifyReadModel({
    db: {},
    now: 2000,
    loadModel: async () => current,
    loadExistingEnvelope: async () => existing,
    uploadEnvelope: async () => {
      uploads += 1;
      return 'unexpected';
    },
  });

  assert.equal(uploads, 0);
  assert.equal(result.published, false);
  assert.equal(result.changed, false);
  assert.equal(result.snapshot_date, '2026-09-29');
  assert.equal(result.source_revision, existing.source_revision);
  assert.equal(result.monthly_listener_revision, '2026-09-29:1790636500000:1');
});

test('Spotify deploy bootstrap republishes the latest D1 model when R2 is stale or pre-v3', async () => {
  const current = model('2026-09-29');
  const stale = {
    ...spotifyBootstrapEnvelope(model('2026-09-28'), 1000),
    renderer_revision: 'spotify-event-v2',
  };
  let uploaded = null;

  const result = await bootstrapSpotifyReadModel({
    db: {},
    now: 2000,
    loadModel: async () => current,
    loadExistingEnvelope: async () => stale,
    uploadEnvelope: async (envelope) => {
      uploaded = envelope;
      return 'pages-response/actions-v2/spotify-playcounts.json';
    },
  });

  assert.equal(result.published, true);
  assert.equal(result.changed, true);
  assert.equal(result.snapshot_date, '2026-09-29');
  assert.equal(result.object_key, 'pages-response/actions-v2/spotify-playcounts.json');
  assert.equal(uploaded.renderer_revision, SPOTIFY_RENDERER_REVISION);
  assert.equal(uploaded.renderer_revision, 'spotify-event-v3');
  assert.equal(uploaded.cadence_seconds, 0);
  const body = JSON.parse(uploaded.body);
  assert.equal(body.groups.sakurazaka46.snapshot_date, '2026-09-29');
  assert.equal(body.monthly_listener_rows.length, 1);
  assert.equal(body.monthly_listener_rows[0].monthly_listeners, 345678);
  assert.match(uploaded.source_revision, /^spotify-event:2026-09-29:/);
  assert.match(uploaded.source_revision, /:2026-09-29:1790636500000:1$/);
});

test('Spotify Worker deployment reconciles the event-driven R2 model after deploy', () => {
  const deploy = deployScript.indexOf("['deploy', '--config', 'wrangler.spotify-playcount.jsonc']");
  const bootstrap = deployScript.indexOf('await bootstrapSpotifyReadModel()');

  assert.match(deployScript, /import \{ bootstrapSpotifyReadModel \} from '\.\/bootstrap-spotify-read-model\.mjs'/);
  assert.ok(deploy >= 0);
  assert.ok(bootstrap > deploy);
});
