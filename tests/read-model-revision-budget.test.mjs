import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadCompactReadModelRevision } from '../worker/scripts/run-pages-read-model-revision-actions.mjs';

const otherMigration = readFileSync(
  new URL('../database/other-migrations/050_read_model_revisions.sql', import.meta.url),
  'utf8',
);
const factsMigration = readFileSync(
  new URL('../database/facts-migrations/059_current_daily_summary_5m.sql', import.meta.url),
  'utf8',
);
const buddiesMigration = readFileSync(
  new URL('../database/buddies-migrations/015_track_history_dirty_days.sql', import.meta.url),
  'utf8',
);

test('history source freshness reads a single compact revision row', async () => {
  const calls = [];
  const env = {
    OTHER_DB: {
      prepare(sql) {
        calls.push(sql);
        return {
          bind(key) {
            assert.equal(key, 'history:daily');
            return { async first() { return { revision: 12, updated_at: 34 }; } };
          },
        };
      },
    },
  };
  assert.equal(
    await loadCompactReadModelRevision({ key: 'history:daily' }, env, 1),
    'compact:history:daily:12:34',
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /FROM sh_read_model_revision/);
  assert.doesNotMatch(calls[0], /COUNT\(|SUM\(|MAX\(/);
});

test('revision migration marks all scheduled history models and weekly ranking', () => {
  for (const key of [
    'history:daily',
    'history:weekly',
    'history:monthly',
    'history:broadcasts',
    'host-history:summary',
    'weekly-ranking',
  ]) assert.match(otherMigration, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(otherMigration, /AFTER INSERT ON sh_daily_summary/);
  assert.match(otherMigration, /AFTER UPDATE ON sh_channel_rankings/);
  assert.match(otherMigration, /AFTER DELETE ON sh_channel_fandoms/);
});

test('current daily projection batches normal writes at five-minute boundaries', () => {
  assert.match(factsMigration, /NEW\.minute_at%300000=0/);
  assert.match(factsMigration, /NEW\.minute_at-300000/);
  assert.match(factsMigration, /trg_sh_current_daily_summary_late_insert/);
  assert.doesNotMatch(factsMigration, /CREATE TRIGGER trg_sh_current_daily_summary_insert\b/);
});

test('track history uses one sparse dirty marker per live day', () => {
  assert.match(buddiesMigration, /CREATE TABLE IF NOT EXISTS sh_track_history_dirty_days/);
  assert.match(buddiesMigration, /INSERT OR IGNORE INTO sh_track_history_dirty_days/);
  assert.match(buddiesMigration, /AFTER INSERT ON sh_queue_items/);
  assert.match(buddiesMigration, /WHERE excluded\.play_date<date\('now'\)/);
});
