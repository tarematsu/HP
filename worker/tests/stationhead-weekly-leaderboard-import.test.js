import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RANKING_TYPE,
  SOURCE_SHEET,
  extractLeaderboardFromArtifact,
  importLeaderboardArtifact,
  mondayDateInJst,
  parseLeaderboardSnapshot,
} from '../scripts/import-stationhead-weekly-leaderboard-actions.mjs';

function artifactWith(snapshot, overrides = {}) {
  const observedAt = overrides.observed_at ?? Date.parse('2026-09-21T15:30:00Z'); // Tue 00:30 JST
  return {
    version: 1,
    available: true,
    digest: overrides.digest ?? 'digest-1',
    records: [{
      observed_at: observedAt,
      source: 'dom',
      page: 'https://www.stationhead.com/leaderboard',
      url: 'https://www.stationhead.com/leaderboard',
      method: 'GET',
      status: 200,
      content_type: 'application/json',
      body: JSON.stringify(snapshot),
    }],
  };
}

function completeRanking(first = 'sakurazaka46jp', streams = 1000) {
  return Array.from({ length: 10 }, (_, index) => ({
    rank: index + 1,
    handle: index === 0 ? first : `station${index + 1}`,
    streams: streams - index,
  }));
}

function createFakeDb(initialRows = []) {
  const state = {
    rows: initialRows.map((row) => ({ ...row })),
    batches: 0,
  };
  const statement = (sql, bindings = []) => ({
    sql,
    bindings,
    bind(...values) { return statement(sql, values); },
    async all() {
      if (!/^SELECT raw_json\s+FROM sh_channel_rankings/i.test(sql.trim())) {
        throw new Error(`unexpected all SQL: ${sql}`);
      }
      const [rankingDate, rankingType] = bindings;
      return {
        results: state.rows
          .filter((row) => row.ranking_date === rankingDate && row.ranking_type === rankingType)
          .sort((a, b) => Number(a.rank) - Number(b.rank))
          .map((row) => ({ raw_json: row.raw_json })),
      };
    },
  });
  return {
    state,
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      state.batches += 1;
      for (const item of statements) {
        if (/^DELETE FROM sh_channel_rankings/i.test(item.sql.trim())) {
          const [rankingDate, rankingType] = item.bindings;
          state.rows = state.rows.filter((row) => row.ranking_date !== rankingDate || row.ranking_type !== rankingType);
          continue;
        }
        if (/^INSERT INTO sh_channel_rankings/i.test(item.sql.trim())) {
          const [
            ranking_date, observed_at, ranking_type, rank, channel_name, channel_alias,
            listener_count, member_count, total_listens, source_sheet, source_row,
            quality_score, quality_flags, raw_json, imported_at,
          ] = item.bindings;
          state.rows.push({
            ranking_date, observed_at, ranking_type, rank, channel_name, channel_alias,
            listener_count, member_count, total_listens, source_sheet, source_row,
            quality_score, quality_flags, raw_json, imported_at,
          });
          continue;
        }
        throw new Error(`unexpected batch SQL: ${item.sql}`);
      }
      return statements.map(() => ({ success: true }));
    },
  };
}

test('JST Monday key keeps Monday-night and Tuesday captures in the same week', () => {
  assert.equal(mondayDateInJst(Date.parse('2026-09-21T14:59:00Z')), '2026-09-21');
  assert.equal(mondayDateInJst(Date.parse('2026-09-21T15:01:00Z')), '2026-09-21');
  assert.equal(mondayDateInJst(Date.parse('2026-09-22T12:00:00Z')), '2026-09-21');
});

test('parses a Stationhead weekly table with streams and days', () => {
  const parsed = parseLeaderboardSnapshot({
    schema: 2,
    rows: [
      ['Rank', 'Username', 'Streams', 'Days'],
      ['1', '@sakurazaka46jp', '12,345', '7'],
      ['2', 'sakuramankai', '9.1K', '6'],
      ['3', 'buddies', '8,000', '5'],
    ],
  });
  assert.equal(parsed.parser, 'table-header');
  assert.deepEqual(parsed.rows, [
    { rank: 1, channel_name: 'sakurazaka46jp', channel_alias: 'sakurazaka46jp', streams: 12345, days: 7 },
    { rank: 2, channel_name: 'sakuramankai', channel_alias: 'sakuramankai', streams: 9100, days: 6 },
    { rank: 3, channel_name: 'buddies', channel_alias: 'buddies', streams: 8000, days: 5 },
  ]);
});

test('line fallback requires a consecutive leaderboard sequence', () => {
  const parsed = parseLeaderboardSnapshot({
    schema: 2,
    lines: [
      'All Access Leaderboard',
      '1', 'sakurazaka46jp', 'Streams', '12,345', 'Days', '7',
      '2', 'sakuramankai', '9,100', '6',
      '3', 'buddies', '8,000', '5',
    ],
  });
  assert.equal(parsed.parser, 'line-sequence');
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].channel_name, 'sakurazaka46jp');
  assert.equal(parsed.rows[0].streams, 12345);
  // Bare small integers are ambiguous in the line-only fallback because they can
  // be either the next rank or an optional Days metric. The table parser above
  // is authoritative for Days; line fallback intentionally preserves rank/host/streams.
  assert.equal(parsed.rows[0].days, null);
});

test('extracts only an authenticated ready leaderboard and assigns the JST Monday date', () => {
  const artifact = artifactWith({
    schema: 2,
    captured_at: Date.parse('2026-09-21T15:30:00Z'),
    path: '/leaderboard',
    signed_in: true,
    leaderboard_ready: true,
    ranking: completeRanking('sakurazaka46jp', 12345),
  });
  const extracted = extractLeaderboardFromArtifact(artifact);
  assert.equal(extracted.status, 'ready');
  assert.equal(extracted.ranking_date, '2026-09-21');
  assert.equal(extracted.rows[0].streams, 12345);
});

test('rejects signed-out and incomplete rank-only captures before a database write', async () => {
  const db = createFakeDb();
  const snapshot = {
    schema: 2, path: '/leaderboard', signed_in: false,
    leaderboard_ready: true, ranking: completeRanking(),
  };
  assert.deepEqual(extractLeaderboardFromArtifact(artifactWith(snapshot)),
    { status: 'skipped', reason: 'no-authenticated-ready-snapshot' });
  assert.equal(db.state.batches, 0);

  snapshot.signed_in = true;
  snapshot.leaderboard_ready = false;
  assert.deepEqual(extractLeaderboardFromArtifact(artifactWith(snapshot)),
    { status: 'skipped', reason: 'no-authenticated-ready-snapshot' });

  snapshot.leaderboard_ready = true;
  snapshot.ranking = completeRanking().slice(0, 9);
  await assert.rejects(importLeaderboardArtifact(artifactWith(snapshot), db),
    /could not be parsed into ranking rows/);
  snapshot.ranking = completeRanking().filter((row) => row.rank !== 5);
  await assert.rejects(importLeaderboardArtifact(artifactWith(snapshot), db),
    /could not be parsed into ranking rows/);
  assert.equal(db.state.batches, 0);
});

test('imports the weekly leaderboard once and skips the same R2 digest', async () => {
  const db = createFakeDb();
  const artifact = artifactWith({
    schema: 2,
    captured_at: Date.parse('2026-09-21T15:30:00Z'),
    path: '/leaderboard',
    signed_in: true,
    leaderboard_ready: true,
    ranking: completeRanking('sakurazaka46jp', 12345),
  });

  const first = await importLeaderboardArtifact(artifact, db, 111);
  assert.equal(first.status, 'imported');
  assert.equal(first.row_count, 10);
  assert.equal(db.state.batches, 1);
  assert.equal(db.state.rows.length, 10);
  assert.equal(db.state.rows[0].ranking_type, RANKING_TYPE);
  assert.equal(db.state.rows[0].source_sheet, SOURCE_SHEET);
  assert.equal(db.state.rows[0].total_listens, 12345);
  assert.equal(JSON.parse(db.state.rows[0].raw_json).active_days, null);

  const second = await importLeaderboardArtifact(artifact, db, 222);
  assert.equal(second.status, 'unchanged');
  assert.equal(db.state.batches, 1);
  assert.equal(db.state.rows.length, 10);
});

test('a new R2 digest replaces the whole weekly ranking instead of duplicating it', async () => {
  const db = createFakeDb();
  const firstArtifact = artifactWith({
    schema: 2,
    path: '/leaderboard',
    signed_in: true,
    leaderboard_ready: true,
    ranking: completeRanking(),
  }, { digest: 'digest-1' });
  await importLeaderboardArtifact(firstArtifact, db, 111);

  const secondArtifact = artifactWith({
    schema: 2,
    path: '/leaderboard',
    signed_in: true,
    leaderboard_ready: true,
    ranking: completeRanking('buddies', 1200),
  }, { digest: 'digest-2' });
  const result = await importLeaderboardArtifact(secondArtifact, db, 222);

  assert.equal(result.status, 'imported');
  assert.equal(db.state.batches, 2);
  assert.equal(db.state.rows.length, 10);
  assert.equal(db.state.rows[0].channel_name, 'buddies');
  assert.equal(JSON.parse(db.state.rows[0].raw_json).source_digest, 'digest-2');
});
