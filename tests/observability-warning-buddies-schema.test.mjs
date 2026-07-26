import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const queryUrl = new URL('../.github/scripts/query-cloudflare-observability.py', import.meta.url);
const querySource = readFileSync(queryUrl, 'utf8');
const provisionSource = readFileSync(
  new URL('../worker/scripts/provision-buddies-db.mjs', import.meta.url),
  'utf8',
);

test('observability diagnostics report warn and warning levels without failing the warning-only gate', () => {
  assert.match(querySource, /WARNING_LEVELS\s*=\s*\{"warn",\s*"warning"\}/u);
  assert.match(querySource, /persisted_warning_events=/u);
  assert.match(querySource, /::warning title=Cloudflare Worker warnings/u);
  assert.match(querySource, /return 1 if total_errors or errors else 0/u);
  assert.doesNotMatch(querySource, /return 1 if total_errors or errors or warnings else 0/u);

  const result = spawnSync('python3', [fileURLToPath(queryUrl), '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /severity self-test passed/u);
});

test('buddies provisioning repairs and verifies the production track metadata ISRC column', () => {
  assert.match(provisionSource, /tableColumns\('sh_track_metadata'\)/u);
  assert.match(provisionSource, /ALTER TABLE sh_track_metadata ADD COLUMN isrc TEXT/u);
  assert.match(provisionSource, /sh_track_metadata\.isrc is missing/u);
  assert.match(provisionSource, /ensureTrackMetadataIsrcColumn\(\);/u);
});

test('buddies provisioning applies the Apple Music column removal idempotently', () => {
  assert.match(provisionSource, /APPLE_MUSIC_COMPATIBILITY_MIGRATION/u);
  assert.match(provisionSource, /tableColumns\(table\)\.has\('apple_music_id'\)/u);
  assert.match(provisionSource, /ALTER TABLE \$\{table\} DROP COLUMN apple_music_id/u);
  assert.match(provisionSource, /removeAppleMusicCompatibilityColumns\(\);/u);
});
