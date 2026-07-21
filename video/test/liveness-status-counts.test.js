import assert from 'node:assert/strict';
import test from 'node:test';

import {
  baseLivenessStatusDeltaStatement,
  deathLivenessStatusDeltaStatement
} from '../src/liveness-status-counts.js';

function captureDb() {
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

test('base liveness delta reads pre-mutation video and ranking state by id', () => {
  const db = captureDb();
  const payload = JSON.stringify([
    { id: 1, state: 'dead' },
    { id: 2, state: 'unknown' }
  ]);
  const statement = baseLivenessStatusDeltaStatement(
    db,
    payload,
    '2026-07-19T00:00:00.000Z'
  );

  assert.deepEqual(statement.args, [payload, '24h', '2026-07-19T00:00:00.000Z']);
  assert.match(statement.sql, /CAST\(json_extract\(value, '\$\.id'\) AS INTEGER\)/);
  assert.match(statement.sql, /INNER JOIN videos AS video ON video\.id = input\.id/);
  assert.match(statement.sql, /FROM ranking_entries AS ranking/);
  assert.match(statement.sql, /video\.status = 'active'/);
  assert.match(statement.sql, /active_videos = MAX\(0, active_videos -/);
  assert.match(statement.sql, /feed_mp4_videos = MAX\(0, feed_mp4_videos -/);
  assert.match(statement.sql, /death_videos = death_videos \+/);
  assert.doesNotMatch(statement.sql, /'\$\.mediaType'/);
  assert.doesNotMatch(statement.sql, /'\$\.inFeed'/);
  assert.doesNotMatch(statement.sql, /dirty\s*=/);
});

test('death liveness delta reads post-mutation active and ranking state', () => {
  const db = captureDb();
  const payload = JSON.stringify([
    { state: 'alive', canonicalKey: 'video-a' },
    { state: 'dead', canonicalKey: 'video-b' }
  ]);
  const statement = deathLivenessStatusDeltaStatement(
    db,
    payload,
    '2026-07-19T00:00:00.000Z'
  );

  assert.deepEqual(statement.args, [payload, '24h', '2026-07-19T00:00:00.000Z']);
  assert.match(statement.sql, /WHERE json_extract\(value, '\$\.state'\) = 'alive'/);
  assert.match(statement.sql, /INNER JOIN videos AS video/);
  assert.match(statement.sql, /FROM ranking_entries AS ranking/);
  assert.match(statement.sql, /video\.status = 'active'/);
  assert.match(statement.sql, /death_videos = MAX\(0, death_videos -/);
  assert.doesNotMatch(statement.sql, /dirty\s*=/);
});
