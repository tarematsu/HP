import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { restoreRevivedRankingStatement } from '../src/liveness-feed-maintenance.js';

function createDb() {
  return {
    prepare(sql) {
      return {
        sql: sql.replace(/\s+/g, ' ').trim(),
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        }
      };
    }
  };
}

test('revived videos are restored with one bounded ranking insert', () => {
  const db = createDb();
  const payload = JSON.stringify([{ canonicalKey: 'video-a', state: 'alive' }]);
  const checkedAt = '2026-07-18T22:00:00.000Z';
  const statement = restoreRevivedRankingStatement(db, payload, checkedAt);

  assert.match(statement.sql, /^INSERT OR IGNORE INTO ranking_entries/);
  assert.match(statement.sql, /SELECT \?, video\.id, -video\.id, \?/);
  assert.match(statement.sql, /video\.last_seen_at >= \?/);
  assert.match(statement.sql, /NOT EXISTS \( SELECT 1 FROM video_blocklist/);
  assert.match(statement.sql, /NOT EXISTS \( SELECT 1 FROM video_death_list/);
  assert.match(statement.sql, /current\.video_id = video\.id/);
  assert.doesNotMatch(statement.sql, /COUNT\(\*\)|OFFSET/);
  assert.equal(statement.args[0], '24h');
  assert.equal(statement.args[1], checkedAt);
  assert.equal(statement.args[2], payload);
  assert.equal(statement.args[4], '24h');
});

test('liveness monitoring does not rebuild the complete playback feed', async () => {
  const source = await readFile(new URL('../src/liveness-monitor.js', import.meta.url), 'utf8');
  assert.match(source, /restoreRevivedRankingStatement/);
  assert.doesNotMatch(source, /rebuildPlaybackFeed/);
  assert.doesNotMatch(source, /if \(feedChanged\)/);
});
