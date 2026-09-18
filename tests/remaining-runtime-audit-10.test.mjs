import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { HOST_SUMMARY_SQL, loadHostSummary } from '../site/functions/api/host-history.js';

function hostDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_host_broadcast_sessions (
      id INTEGER,handle TEXT,station_id INTEGER,started_at INTEGER,confirmed_at INTEGER,
      ended_at INTEGER,status TEXT,peak_listeners INTEGER,average_listeners REAL,
      total_listens_start INTEGER,total_listens_end INTEGER,listener_sample_count INTEGER,
      track_count INTEGER,comment_count INTEGER,last_observed_at INTEGER
    );
    CREATE TABLE sh_official_broadcast_summary (
      host_handle TEXT,started_at INTEGER,ended_at INTEGER,
      listener_max INTEGER,listener_avg REAL,sample_count INTEGER,distinct_tracks INTEGER
    );
  `);
  return db;
}

function wrappedDatabase(db) {
  let statements = 0;
  return {
    get statements() { return statements; },
    prepare(sql) {
      statements += 1;
      assert.equal(sql, HOST_SUMMARY_SQL);
      const statement = db.prepare(sql);
      return { all: async () => ({ results: statement.all() }) };
    },
  };
}

test('host summary returns active and recent Sakurazaka sessions from one SQL statement', async () => {
  const db = hostDatabase();
  db.prepare(`INSERT INTO sh_host_broadcast_sessions VALUES
    (1,'sakurazaka46jp',10,100,110,200,'ended',30,20,1000,1100,2,3,4,200),
    (2,'sakurazaka46jp',11,300,310,NULL,'active',40,NULL,1200,NULL,3,4,5,320)`).run();

  const wrapped = wrappedDatabase(db);
  const summary = await loadHostSummary(wrapped);
  assert.equal(wrapped.statements, 1);
  assert.equal('latestProfile' in summary, false);
  assert.equal(summary.activeSession.id, 2);
  assert.deepEqual(summary.recentSessions.map((row) => row.id), [2, 1]);
});

test('host summary falls back to official broadcast history when session tracking is empty', async () => {
  const db = hostDatabase();
  db.prepare(`INSERT INTO sh_official_broadcast_summary VALUES
    ('sakurazaka46jp',1000,1200,55,42.5,12,7),
    ('sakurazaka46jp',2000,2300,80,63.5,18,9)`).run();
  const wrapped = wrappedDatabase(db);
  const summary = await loadHostSummary(wrapped);
  assert.equal(wrapped.statements, 1);
  assert.equal(summary.activeSession, null);
  assert.deepEqual(summary.recentSessions.map((row) => row.started_at), [2000, 1000]);
  assert.equal(summary.recentSessions[0].peak_listeners, 80);
  assert.equal(summary.recentSessions[0].track_count, 9);
});

test('history runtime is embedded in the main dashboard and reuses prepared chart state', () => {
  const html = readFileSync(new URL('../site/public/index.html', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../site/public/dashboard-tabs.js', import.meta.url), 'utf8');
  assert.equal((html.match(/<script /g) || []).length, 1);
  assert.match(html, /id="historyView"/);
  assert.match(tabs, /import\('\/history\/history-main\.js'\)/);
  assert.doesNotMatch(html, /href="\/history/);

  const runtime = readFileSync(
    new URL('../site/public/history/history-lite.js', import.meta.url),
    'utf8',
  );
  assert.match(runtime, /function prepareCanvas\(\)/);
  assert.match(runtime, /function drawSummaryChart\(\)/);
  assert.match(runtime, /state\.chartModel = \{ positions, rows \}/);
  assert.match(runtime, /state\.chartModel\.positions\.forEach/);
  assert.match(runtime, /const PAGE_SIZE = 200/);
  assert.match(runtime, /sessionStorage\.getItem/);
});
