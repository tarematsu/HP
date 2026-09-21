import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repairUrl = new URL('../worker/scripts/repair-legacy-ranking-all-actions.mjs', import.meta.url);
const repair = readFileSync(repairUrl, 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/run-track-metadata-repair.yml', import.meta.url), 'utf8');

test('all-unresolved legacy ranking repair script has valid Node syntax', () => {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(repairUrl)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('ISRC repair scans all unresolved ranking rows regardless of Spotify ID', () => {
  assert.match(repair, /FROM sh_track_ranking_current current/);
  assert.match(repair, /current\.track_identity LIKE 'isrc:%'/);
  assert.match(repair, /FROM sh_track_ranking_occurrence o/);
  assert.match(repair, /LEFT JOIN sh_track_dictionary dictionary/);
  assert.match(repair, /LEFT JOIN sh_isrc_metadata metadata/);
  assert.doesNotMatch(repair, /WHERE \(unresolved\.spotify_id IS NULL OR TRIM\(unresolved\.spotify_id\)=''\)/);
});

test('all-unresolved repair falls back to MusicBrainz and persists reusable metadata', () => {
  assert.match(repair, /fetchIsrcMetadata\(isrc/);
  assert.match(repair, /INSERT INTO sh_isrc_metadata/);
  assert.match(repair, /INSERT INTO sh_track_dictionary/);
  assert.match(repair, /INSERT INTO sh_track_metadata/);
  assert.match(repair, /UPDATE sh_track_ranking_current SET/);
  assert.match(repair, /UPDATE sh_track_ranking_occurrence SET/);
  assert.match(repair, /UPDATE sh_tracks SET/);
});

test('scheduled metadata repair runs all-unresolved fallback before Spotify-only legacy repair', () => {
  const isrcIndex = workflow.indexOf('node scripts/repair-legacy-ranking-all-actions.mjs');
  const spotifyIndex = workflow.indexOf('node scripts/repair-legacy-ranking-metadata-actions.mjs');
  assert.ok(isrcIndex >= 0, 'all-unresolved repair step must exist');
  assert.ok(spotifyIndex >= 0, 'Spotify legacy repair step must exist');
  assert.ok(isrcIndex < spotifyIndex, 'ISRC fallback must run before Spotify legacy repair');
});

test('metadata repair runs immediately when repair code changes on main', () => {
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /worker\/scripts\/repair-legacy-ranking-all-actions\.mjs/);
  assert.match(workflow, /worker\/scripts\/repair-legacy-ranking-metadata-actions\.mjs/);
});
