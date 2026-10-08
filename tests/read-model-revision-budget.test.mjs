import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadReadModelRevisions } from '../worker/src/read-model-revision.js';

const otherMigration = readFileSync(new URL('../database/other-migrations/053_read_model_revisions.sql', import.meta.url), 'utf8');
const completedRevisionMigration = readFileSync(new URL('../database/other-migrations/056_completed_read_model_revisions.sql', import.meta.url), 'utf8');
const monthlyRemovalMigration = readFileSync(new URL('../database/other-migrations/057_remove_monthly_read_model_revision.sql', import.meta.url), 'utf8');
const trackHistoryRevisionMigration = readFileSync(new URL('../database/other-migrations/061_track_history_read_model_revision.sql', import.meta.url), 'utf8');
const factsMigration = readFileSync(new URL('../database/facts-migrations/059_current_daily_summary_5m.sql', import.meta.url), 'utf8');
const buddiesMigration = readFileSync(new URL('../database/buddies-migrations/015_track_history_dirty_days.sql', import.meta.url), 'utf8');

test('history source freshness reads compact revision rows without historical scans', async () => {
  const calls = [];
  const db = { prepare(sql) {
    calls.push(sql);
    return { bind(...keys) { this.keys = keys; return this; }, async all() {
      return { results: this.keys.map((key, index) => ({ model_key: key, revision: index + 1, updated_at: 34 })) };
    } };
  } };
  const result = await loadReadModelRevisions(db, ['history:daily', 'history:weekly']);
  assert.equal(result.size, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /FROM sh_read_model_revision/);
  assert.doesNotMatch(calls[0], /COUNT\(|SUM\(|MAX\(/);
});

test('revision migrations cover scheduled history, weekly ranking, and R2-native track history', () => {
  for (const key of ['history:daily','history:weekly','history:broadcasts','host-history:summary','weekly-ranking']) {
    assert.match(otherMigration, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(otherMigration, /AFTER INSERT ON sh_daily_summary/);
  assert.match(otherMigration, /AFTER UPDATE ON sh_channel_rankings/);
  assert.match(otherMigration, /AFTER DELETE ON sh_channel_fandoms/);
  assert.match(trackHistoryRevisionMigration, /VALUES\('track-history',1,unixepoch\(\)\*1000\)/);
});

test('completed-period revisions remain for daily and weekly while monthly is retired', () => {
  for (const table of ['sh_daily_summary', 'sh_weekly_summary']) {
    assert.match(completedRevisionMigration, new RegExp(`AFTER INSERT ON ${table}\\nWHEN NEW\\.period_end<=unixepoch\\(\\)\\*1000`), table);
    assert.match(completedRevisionMigration, new RegExp(`AFTER UPDATE ON ${table}\\nWHEN NEW\\.period_end<=unixepoch\\(\\)\\*1000`), table);
    assert.match(completedRevisionMigration, new RegExp(`AFTER DELETE ON ${table}\\nWHEN OLD\\.period_end<=unixepoch\\(\\)\\*1000`), table);
  }
  assert.match(completedRevisionMigration, /trg_rmrev_weekly_ranking_update/);
  assert.match(monthlyRemovalMigration, /DELETE FROM sh_read_model_revision WHERE model_key='history:monthly'/);
});

test('current daily projection batches normal writes at five-minute boundaries', () => {
  assert.match(factsMigration, /NEW\.minute_at%300000=0/);
  assert.match(factsMigration, /NEW\.minute_at-300000/);
  assert.match(factsMigration, /trg_sh_current_daily_summary_late_insert/);
});

test('track history uses one sparse dirty marker per live day', () => {
  assert.match(buddiesMigration, /CREATE TABLE IF NOT EXISTS sh_track_history_dirty_days/);
  assert.match(buddiesMigration, /INSERT OR IGNORE INTO sh_track_history_dirty_days/);
  assert.match(buddiesMigration, /AFTER INSERT ON sh_queue_items/);
});
