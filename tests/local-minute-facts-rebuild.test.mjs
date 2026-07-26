import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('local minute rebuild emits bounded conditional D1 uploads', () => {
  const directory = mkdtempSync(join(tmpdir(), 'minute-facts-local-'));
  const source = join(directory, 'buddies.sql');
  const output = join(directory, 'out');
  writeFileSync(source, `
CREATE TABLE sh_channel_snapshots(
  id INTEGER PRIMARY KEY, observed_at INTEGER, channel_id INTEGER, station_id INTEGER,
  is_broadcasting INTEGER, listener_count INTEGER, online_member_count INTEGER,
  total_member_count INTEGER, guest_count INTEGER, total_listens INTEGER,
  current_stream_count INTEGER, broadcast_start_time INTEGER
);
CREATE TABLE sh_comment_minute_counts(
  station_id INTEGER, bucket_start INTEGER, comment_count INTEGER,
  PRIMARY KEY(station_id,bucket_start)
);
INSERT INTO sh_channel_snapshots VALUES
  (1,60010,318,9,1,10,11,12,1,100,4,50000),
  (2,180010,318,9,1,20,21,22,2,110,5,50000);
INSERT INTO sh_comment_minute_counts VALUES(9,60000,3);
`, 'utf8');

  execFileSync('python3', [
    join(root, 'scripts/rebuild-minute-facts-from-buddies.py'),
    '--buddies-export', source,
    '--out-dir', output,
    '--now-ms', '600000',
    '--recent-guard-ms', '0',
  ]);

  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.candidates, 3);
  assert.equal(manifest.exact, 2);
  assert.equal(manifest.carry_forward, 1);
  assert.ok(manifest.chunks.every((chunk) => chunk.bytes <= 90_000));
  const upload = manifest.chunks
    .map((chunk) => readFileSync(join(output, chunk.file), 'utf8'))
    .join('\n');
  assert.match(upload, /ON CONFLICT\(channel_id,minute_at\) DO UPDATE/);
  assert.match(upload, /source_priority>sh_minute_facts.source_priority/);
  assert.match(upload, /snapshot:1:minute:120000:carry_forward/);
  assert.doesNotMatch(upload, /auth_token|device_uid|raw_json/);
});

test('database workflow keeps the scoped export local until final upload', () => {
  const workflow = readFileSync(join(root, '.github/workflows/database.yml'), 'utf8');
  assert.match(workflow, /--table sh_channel_snapshots/);
  assert.match(workflow, /--table sh_comment_minute_counts/);
  assert.match(workflow, /rebuild-minute-facts-from-buddies\.py/);
  assert.match(workflow, /d1 execute "\$FACTS_DATABASE_NAME"[\s\S]*--file "\$chunk"/);
  assert.doesNotMatch(workflow, /--table sh_worker_collector_state/);
});
