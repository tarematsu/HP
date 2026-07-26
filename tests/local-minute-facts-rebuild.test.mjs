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
  assert.ok(manifest.chunks.every((chunk) => chunk.bytes <= 5_000_000));
  const upload = manifest.chunks
    .map((chunk) => readFileSync(join(output, chunk.file), 'utf8'))
    .join('\n');
  assert.ok(
    upload.split('\n').filter(Boolean).every((statement) => Buffer.byteLength(statement) <= 90_000),
  );
  assert.match(upload, /ON CONFLICT\(channel_id,minute_at\) DO UPDATE/);
  assert.match(upload, /source_priority>sh_minute_facts.source_priority/);
  assert.match(upload, /snapshot:1:minute:120000:carry_forward/);
  assert.doesNotMatch(upload, /auth_token|device_uid|raw_json/);
});

test('local minute rebuild accepts bounded Wrangler JSON exports', () => {
  const directory = mkdtempSync(join(tmpdir(), 'minute-facts-json-'));
  const snapshots = join(directory, 'snapshots.json');
  const comments = join(directory, 'comments.json');
  const output = join(directory, 'out');
  writeFileSync(snapshots, JSON.stringify([{
    results: [
      {
        id: 1, observed_at: 60010, channel_id: 318, station_id: 9,
        is_broadcasting: 1, listener_count: 10, online_member_count: 11,
        total_member_count: 12, guest_count: 1, total_listens: 100,
        current_stream_count: 4, broadcast_start_time: 50000,
      },
      {
        id: 2, observed_at: 180010, channel_id: 318, station_id: 9,
        is_broadcasting: 1, listener_count: 20, online_member_count: 21,
        total_member_count: 22, guest_count: 2, total_listens: 110,
        current_stream_count: 5, broadcast_start_time: 50000,
      },
    ],
  }]), 'utf8');
  writeFileSync(comments, JSON.stringify([{
    results: [{ station_id: 9, bucket_start: 60000, comment_count: 3 }],
  }]), 'utf8');

  execFileSync('python3', [
    join(root, 'scripts/rebuild-minute-facts-from-buddies.py'),
    '--snapshots-json', snapshots,
    '--comments-json', comments,
    '--out-dir', output,
    '--now-ms', '600000',
    '--recent-guard-ms', '0',
  ]);

  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.candidates, 3);
  assert.equal(manifest.exact, 2);
  assert.equal(manifest.carry_forward, 1);
});

test('collector snapshot cadence stays within the local carry-forward horizon', () => {
  const collector = JSON.parse(readFileSync(
    join(root, 'worker/wrangler.buddies-collector.jsonc'),
    'utf8',
  ));
  const rebuild = readFileSync(
    join(root, 'scripts/rebuild-minute-facts-from-buddies.py'),
    'utf8',
  );
  const carryMinutes = Number(rebuild.match(/MAX_CARRY_MINUTES\s*=\s*(\d+)/)?.[1]);
  const persistIntervalMs = Number(collector.vars?.SNAPSHOT_PERSIST_INTERVAL_MS);
  assert.ok(Number.isFinite(carryMinutes) && carryMinutes > 0);
  assert.ok(Number.isFinite(persistIntervalMs) && persistIntervalMs > 0);
  assert.ok(
    persistIntervalMs <= carryMinutes * 60_000,
    `snapshot persistence ${persistIntervalMs}ms exceeds ${carryMinutes}-minute carry horizon`,
  );
});

test('database workflow exports an incremental window before final upload', () => {
  const workflow = readFileSync(join(root, '.github/workflows/database.yml'), 'utf8');
  const caller = readFileSync(
    join(root, '.github/workflows/run-local-minute-facts-rebuild.yml'),
    'utf8',
  );
  assert.match(workflow, /minute-facts-actions-window\.mjs export/);
  assert.match(workflow, /--snapshots-json/);
  assert.match(workflow, /--comments-json/);
  assert.match(workflow, /rebuild-minute-facts-from-buddies\.py/);
  assert.match(workflow, /d1 execute "\$FACTS_DATABASE_NAME"[\s\S]*--file "\$chunk"/);
  assert.match(workflow, /minute-facts-actions-window\.mjs complete/);
  assert.match(workflow, /for attempt in 1 2 3 4 5 6/);
  assert.match(workflow, /D1 import still busy; retrying/);
  assert.match(workflow, /Failed to upload \$\(basename "\$chunk"\) after 6 attempts/);
  assert.doesNotMatch(workflow, /--table sh_worker_collector_state/);
  assert.match(caller, /cron: '7,22,37,52 \* \* \* \*'/);
  assert.match(caller, /group: minute-facts-local-rebuild/);
  assert.match(caller, /cancel-in-progress: true/);
  assert.match(
    workflow,
    /if: \(github\.event_name == 'push' && inputs\.operation == ''\) \|\| inputs\.operation == 'buddies-db'/,
  );
});
