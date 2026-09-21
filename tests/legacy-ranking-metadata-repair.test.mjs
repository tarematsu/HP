import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repairUrl = new URL('../worker/scripts/repair-legacy-ranking-metadata-actions.mjs', import.meta.url);
const repair = readFileSync(repairUrl, 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/run-track-metadata-repair.yml', import.meta.url), 'utf8');

test('legacy ranking repair script has valid Node syntax', () => {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(repairUrl)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('legacy ranking repair scans persisted ranking rows instead of only recent likes', () => {
  assert.match(repair, /FROM sh_track_ranking_current current/);
  assert.match(repair, /LOWER\(TRIM\(current\.title\)\) IN \('曲名不明'/);
  assert.match(repair, /LOWER\(TRIM\(current\.artist\)\) IN \('アーティスト不明'/);
  assert.match(repair, /current\.latest_like_count>0/);
  assert.doesNotMatch(repair, /observed_at>=\$\{cutoff\}/);
});

test('legacy ranking repair persists recovered metadata into reusable read models', () => {
  assert.match(repair, /INSERT INTO sh_track_metadata/);
  assert.match(repair, /UPDATE sh_track_ranking_current SET/);
  assert.match(repair, /UPDATE sh_track_ranking_occurrence SET/);
  assert.match(repair, /UPDATE sh_tracks SET/);
  assert.match(repair, /ON CONFLICT\(spotify_id\) DO UPDATE SET/);
});

test('scheduled metadata repair runs the legacy ranking backfill', () => {
  assert.match(workflow, /TRACK_METADATA_LEGACY_LIMIT: '500'/);
  assert.match(workflow, /node scripts\/repair-legacy-ranking-metadata-actions\.mjs/);
});
