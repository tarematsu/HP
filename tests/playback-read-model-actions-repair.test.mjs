import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/run-track-metadata-repair.yml', root), 'utf8');
const script = readFileSync(new URL('worker/scripts/repair-playback-read-model-actions.mjs', root), 'utf8');

test('metadata repair workflow runs the persisted queue identity repair', () => {
  assert.match(workflow, /worker\/scripts\/repair-playback-read-model-actions\.mjs/);
  assert.match(workflow, /node scripts\/repair-playback-read-model-actions\.mjs/);
});

test('playback Actions repair recovers missing track identity by station, queue start and position', () => {
  assert.match(script, /SELECT channel_id,station_id,start_time,queue_json/);
  assert.match(script, /FROM sh_queue_items/);
  assert.match(script, /WHERE station_id=\$\{quote\(station\)\} AND start_time=\$\{quote\(start\)\}/);
  assert.match(script, /identityByPosition/);
  assert.match(script, /integer\(track\.position\) \?\? index/);
  assert.match(script, /text\(track\.spotify_id\) \|\| text\(identity\?\.spotify_id\)/);
});

test('playback Actions repair hydrates recovered identity from track metadata and persists queue_json', () => {
  assert.match(script, /FROM sh_track_metadata/);
  assert.match(script, /trackTitleValue\(track\.title\) \|\| trackTitleValue\(metadata\?\.title\)/);
  assert.match(script, /trackArtistValue\(track\.artist\) \|\| trackArtistValue\(metadata\?\.artist\)/);
  assert.match(script, /UPDATE sh_queue_read_model_current SET queue_json=/);
  assert.match(script, /read_models_repaired: statements\.length/);
});
