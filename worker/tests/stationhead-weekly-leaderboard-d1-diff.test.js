import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { importLeaderboardArtifact } from '../src/stationhead-leaderboard-worker.js';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../database/other-migrations/014_restore_channel_rankings.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../database/other-migrations/072_weekly_leaderboard_import_state.sql', import.meta.url), 'utf8'));
  sqlite.exec(`
    CREATE TABLE revision_write_log (id INTEGER PRIMARY KEY, kind TEXT NOT NULL);
    CREATE TRIGGER log_weekly_insert AFTER INSERT ON sh_channel_rankings BEGIN
      INSERT INTO revision_write_log(kind) VALUES('insert');
    END;
    CREATE TRIGGER log_weekly_update AFTER UPDATE ON sh_channel_rankings BEGIN
      INSERT INTO revision_write_log(kind) VALUES('update');
    END;
    CREATE TRIGGER log_weekly_delete AFTER DELETE ON sh_channel_rankings BEGIN
      INSERT INTO revision_write_log(kind) VALUES('delete');
    END;
  `);
  const d1Statement = (sql, bindings = []) => ({
    sql,
    bindings,
    bind(...args) { return d1Statement(sql, args); },
    async first() { return sqlite.prepare(sql).get(...bindings) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...bindings).changes } }; },
  });
  const db = {
    prepare(sql) { return d1Statement(sql); },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const changes = [];
        for (const stmt of statements) changes.push((await stmt.run()).meta.changes);
        sqlite.exec('COMMIT');
        return changes;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const history = () => sqlite.prepare('SELECT kind,COUNT(*) AS count FROM revision_write_log GROUP BY kind ORDER BY kind')
    .all().map(row => ({ ...row }));
  const ranking = () => sqlite.prepare(`SELECT rank,channel_name,total_listens,raw_json,observed_at
    FROM sh_channel_rankings WHERE ranking_type='週間リーダーボード'
    ORDER BY rank ASC`).all().map(row => ({ ...row }));
  return { sqlite, db, history, ranking };
}

function artifact(rows, digest, time) {
  return {
    version: 1,
    digest,
    records: [{
      observed_at: time,
      source: 'dom',
      body: JSON.stringify({ ranking: rows }),
    }],
  };
}
function top100() {
  return Array.from({ length: 100 }, (_, i) => ({
    rank: i + 1,
    name: `station${String(i).padStart(3, '0')}`,
    streams: 10000 - i,
    days: 7,
  }));
}

test('real SQLite weekly import updates only a changed rank with one revision trigger', async () => {
  const { sqlite, db, history, ranking } = database();
  try {
    const t0 = Date.parse('2026-10-12T15:00:00Z');
    const rows = top100();
    assert.equal((await importLeaderboardArtifact(artifact(rows, 'first', t0), db, 100)).status, 'imported');
    assert.equal(ranking().length, 100);
    assert.deepEqual(history(), [{ kind: 'insert', count: 100 }]);
    const original = ranking();
    const changed = rows.map(row => ({ ...row }));
    changed[36].streams += 100;
    assert.equal((await importLeaderboardArtifact(artifact(changed, 'second', t0 + 60000), db, 200)).status, 'imported');
    assert.deepEqual(history(), [
      { kind: 'insert', count: 100 },
      { kind: 'update', count: 1 },
    ]);
    assert.equal(ranking()[36].total_listens, changed[36].streams);
    assert.equal(ranking()[36].observed_at, t0 + 60000);
    assert.deepEqual(ranking()[0], original[0]);
    assert.deepEqual(ranking()[99], original[99]);
    assert.equal((await importLeaderboardArtifact(artifact(changed, 'second', t0 + 60000), db, 300)).status, 'unchanged');
    assert.deepEqual(history(), [
      { kind: 'insert', count: 100 },
      { kind: 'update', count: 1 },
    ]);
  } finally { sqlite.close(); }
});

test('rank changes and corrupted saved rankings preserve exact Top 100 through repair', async () => {
  const { sqlite, db, history, ranking } = database();
  try {
    const t0 = Date.parse('2026-10-12T15:00:00Z');
    const rows = top100();
    await importLeaderboardArtifact(artifact(rows, 'first', t0), db, 100);
    const moved = rows.map(row => ({ ...row }));
    [moved[0].name, moved[1].name] = [moved[1].name, moved[0].name];
    await importLeaderboardArtifact(artifact(moved, 'swapped', t0 + 60000), db, 200);
    assert.deepEqual(history(), [
      { kind: 'insert', count: 100 },
      { kind: 'update', count: 2 },
    ]);
    sqlite.prepare(`DELETE FROM sh_channel_rankings WHERE rank=77 AND ranking_type='週間リーダーボード'`).run();
    const latest = moved.map(row => ({ ...row }));
    latest[30].days += 1;
    await importLeaderboardArtifact(artifact(latest, 'repaired', t0 + 120000), db, 300);
    assert.equal(ranking().length, 100);
    assert.deepEqual(ranking().map(row => Number(row.rank)), Array.from({ length: 100 }, (_, i) => i + 1));
    assert.deepEqual(history(), [
      { kind: 'delete', count: 100 },
      { kind: 'insert', count: 200 },
      { kind: 'update', count: 2 },
    ]);
    assert.equal(JSON.parse(ranking()[30].raw_json).active_days, 8);
  } finally { sqlite.close(); }
});
