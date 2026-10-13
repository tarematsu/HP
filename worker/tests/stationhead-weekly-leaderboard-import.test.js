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

function completeRanking({ prefix = 'channel', firstName = null, firstStreams = null } = {}) {
  return Array.from({ length: 100 }, (_, index) => ({
    rank: index + 1,
    name: index === 0 && firstName ? firstName : `${prefix}${String(index + 1).padStart(3, '0')}`,
    streams: index === 0 && firstStreams != null ? firstStreams : 100_000 - index,
    days: 7,
  }));
}

function createFakeDb(initialRows = []) {
  const state = {
    rows: initialRows.map((row) => ({ ...row })),
    checkpoints: new Map(),
    checkpointWrites: 0,
    batches: 0,
    rankingRowWrites: 0,
    rankingUpdates: 0,
    rankingDeletes: 0,
    rankingInserts: 0,
  };
  const writeCheckpoint = (values) => {
    const [ranking_date, observed_at, source_digest, content_json] = values;
    const previous = state.checkpoints.get(ranking_date);
    if (previous && previous.observed_at > observed_at) return;
    state.checkpoints.set(ranking_date, { observed_at, source_digest, content_json });
    state.checkpointWrites += 1;
  };
  const statement = (sql, bindings = []) => ({
    sql,
    bindings,
    bind(...values) { return statement(sql, values); },
    async first() {
      if (!/^SELECT observed_at,source_digest,content_json\s+FROM sh_weekly_leaderboard_import_state/i.test(sql.trim())) {
        throw new Error(`unexpected first SQL: ${sql}`);
      }
      return state.checkpoints.get(bindings[0]) || null;
    },
    async run() {
      if (!/^INSERT INTO sh_weekly_leaderboard_import_state/i.test(sql.trim())) {
        throw new Error(`unexpected run SQL: ${sql}`);
      }
      writeCheckpoint(bindings);
      return { success: true };
    },
    async all() {
      if (!/^SELECT rank,channel_name,channel_alias,total_listens,raw_json\s+FROM sh_channel_rankings/i.test(sql.trim())) {
        throw new Error(`unexpected all SQL: ${sql}`);
      }
      const [rankingDate, rankingType] = bindings;
      return {
        results: state.rows
          .filter((row) => row.ranking_date === rankingDate && row.ranking_type === rankingType)
          .sort((a, b) => Number(a.rank) - Number(b.rank))
          .map((row) => ({
            rank: row.rank, channel_name: row.channel_name, channel_alias: row.channel_alias,
            total_listens: row.total_listens, raw_json: row.raw_json,
          })),
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
          const previousCount = state.rows.length;
          state.rows = state.rows.filter((row) => row.ranking_date !== rankingDate || row.ranking_type !== rankingType);
          state.rankingDeletes += previousCount - state.rows.length;
          state.rankingRowWrites += previousCount - state.rows.length;
          continue;
        }
        if (/^UPDATE sh_channel_rankings SET/i.test(item.sql.trim())) {
          const [
            observed_at, channel_name, channel_alias, listener_count, member_count,
            total_listens, source_sheet, source_row, quality_score, quality_flags,
            raw_json, imported_at, rankingDate, rankingType, rank,
          ] = item.bindings;
          const matches = state.rows.filter((row) =>
            row.ranking_date === rankingDate && row.ranking_type === rankingType && Number(row.rank) === Number(rank));
          assert.equal(matches.length, 1, 'targeted update must only touch one existing ranking row');
          Object.assign(matches[0], {
            observed_at, channel_name, channel_alias, listener_count, member_count,
            total_listens, source_sheet, source_row, quality_score, quality_flags,
            raw_json, imported_at,
          });
          state.rankingUpdates += 1;
          state.rankingRowWrites += 1;
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
          state.rankingInserts += 1;
          state.rankingRowWrites += 1;
          continue;
        }
        if (/^INSERT INTO sh_weekly_leaderboard_import_state/i.test(item.sql.trim())) {
          writeCheckpoint(item.bindings);
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
    rows: [
      ['Rank', 'Username', 'Streams', 'Days'],
      ['1', 'sakurazaka46jp', '12345', '7'],
    ],
  });
  const extracted = extractLeaderboardFromArtifact(artifact);
  assert.equal(extracted.status, 'ready');
  assert.equal(extracted.ranking_date, '2026-09-21');
  assert.equal(extracted.rows[0].streams, 12345);
});

test('imports the weekly leaderboard once and skips the same R2 digest', async () => {
  const db = createFakeDb();
  const artifact = artifactWith({
    schema: 2,
    captured_at: Date.parse('2026-09-21T15:30:00Z'),
    path: '/leaderboard',
    signed_in: true,
    leaderboard_ready: true,
    ranking: completeRanking({ firstName: 'sakurazaka46jp', firstStreams: 12345 }),
  });

  const first = await importLeaderboardArtifact(artifact, db, 111);
  assert.equal(first.status, 'imported');
  assert.equal(first.row_count, 100);
  assert.equal(db.state.batches, 1);
  assert.equal(db.state.rows.length, 100);
  assert.equal(db.state.rows[0].ranking_type, RANKING_TYPE);
  assert.equal(db.state.rows[0].source_sheet, SOURCE_SHEET);
  assert.equal(db.state.rows[0].total_listens, 12345);
  assert.equal(JSON.parse(db.state.rows[0].raw_json).active_days, 7);

  const second = await importLeaderboardArtifact(artifact, db, 222);
  assert.equal(second.status, 'unchanged');
  assert.equal(db.state.batches, 1);
  assert.equal(db.state.rows.length, 100);
});

test('a fully changed R2 digest updates the complete weekly ranking without duplication', async () => {
  const db = createFakeDb();
  const firstArtifact = artifactWith({
    schema: 2,
    path: '/leaderboard',
    signed_in: true,
    leaderboard_ready: true,
    ranking: completeRanking({ prefix: 'first', firstName: 'sakurazaka46jp', firstStreams: 1000 }),
  }, { digest: 'digest-1' });
  await importLeaderboardArtifact(firstArtifact, db, 111);

  const secondArtifact = artifactWith({
    schema: 2,
    path: '/leaderboard',
    signed_in: true,
    leaderboard_ready: true,
    ranking: completeRanking({ prefix: 'second', firstName: 'buddies', firstStreams: 1200 }),
  }, { digest: 'digest-2' });
  const result = await importLeaderboardArtifact(secondArtifact, db, 222);

  assert.equal(result.status, 'imported');
  assert.equal(db.state.batches, 2);
  assert.equal(db.state.rankingDeletes, 0, 'a complete prior ranking needs no wholesale delete');
  assert.equal(db.state.rankingUpdates, 100, 'each changed rank is updated once');
  assert.equal(db.state.rows.length, 100);
  assert.equal(db.state.rows[0].channel_name, 'buddies');
  assert.equal(JSON.parse(db.state.rows[0].raw_json).source_digest, 'digest-2');
});

test('a late older observation cannot overwrite a newer same-week ranking', async () => {
  const db = createFakeDb();
  const snapshot = { ranking: completeRanking({ firstStreams: 1200 }) };
  await importLeaderboardArtifact(artifactWith(snapshot, {
    digest: 'newer', observed_at: Date.parse('2026-09-22T15:30:00Z'),
  }), db);
  const result = await importLeaderboardArtifact(artifactWith({ ranking: completeRanking({ firstStreams: 1000 }) }, {
    digest: 'older', observed_at: Date.parse('2026-09-21T15:30:00Z'),
  }), db);
  assert.equal(result.status, 'stale');
  assert.equal(db.state.batches, 1);
  assert.equal(db.state.rows[0].total_listens, 1200);
});

test('a newer capture with identical ranks, streams and days writes only a checkpoint', async () => {
  const db = createFakeDb();
  const snapshot = { ranking: completeRanking({ firstName: 'sakurazaka46jp' }) };
  const first = artifactWith(snapshot, { digest: 'capture-1', observed_at: Date.parse('2026-09-21T15:30:00Z') });
  const newer = artifactWith(snapshot, { digest: 'capture-2', observed_at: Date.parse('2026-09-21T16:30:00Z') });
  assert.equal((await importLeaderboardArtifact(first, db, 100)).status, 'imported');
  const originalRows = db.state.rows.map((row) => row.raw_json);
  const changes = await importLeaderboardArtifact(newer, db, 200);
  assert.equal(changes.status, 'unchanged');
  assert.equal(db.state.batches, 1, 'no 100-row delete + insert');
  assert.deepEqual(db.state.rows.map((row) => row.raw_json), originalRows);
  assert.equal(db.state.checkpointWrites, 2);

  const repeated = await importLeaderboardArtifact(newer, db, 300);
  assert.equal(repeated.status, 'unchanged');
  assert.equal(db.state.checkpointWrites, 2, 'identical observation makes no D1 write');

  const staleChanged = artifactWith({ ranking: completeRanking({ prefix: 'stale' }) }, {
    digest: 'stale-content', observed_at: Date.parse('2026-09-21T15:45:00Z'),
  });
  assert.equal((await importLeaderboardArtifact(staleChanged, db, 400)).status, 'stale');
  assert.equal(db.state.batches, 1);
  assert.equal(db.state.checkpointWrites, 2);
});

test('changes to days or streams still replace weekly content', async () => {
  const db = createFakeDb();
  const base = artifactWith({ ranking: completeRanking({ firstStreams: 1000 }) }, {
    digest: 'first', observed_at: Date.parse('2026-09-21T15:30:00Z'),
  });
  const next = artifactWith({ ranking: completeRanking({ firstStreams: 1001 }) }, {
    digest: 'changed', observed_at: Date.parse('2026-09-21T16:30:00Z'),
  });
  await importLeaderboardArtifact(base, db, 100);
  assert.equal((await importLeaderboardArtifact(next, db, 200)).status, 'imported');
  assert.equal(db.state.batches, 2);
  assert.equal(db.state.rows[0].total_listens, 1001);
});

test('legacy rows seed the new checkpoint without replacing a matching Top 100', async () => {
  const seed = createFakeDb();
  const base = artifactWith({ ranking: completeRanking({ firstStreams: 1000 }) }, {
    digest: 'previous-capture', observed_at: Date.parse('2026-09-21T15:30:00Z'),
  });
  await importLeaderboardArtifact(base, seed, 100);
  const legacy = createFakeDb(seed.state.rows);
  const unchanged = artifactWith({ ranking: completeRanking({ firstStreams: 1000 }) }, {
    digest: 'new-capture', observed_at: Date.parse('2026-09-21T16:30:00Z'),
  });
  assert.equal((await importLeaderboardArtifact(unchanged, legacy, 200)).status, 'unchanged');
  assert.equal(legacy.state.batches, 0);
  assert.equal(legacy.state.checkpointWrites, 1);
  assert.equal(legacy.state.rows.length, 100);
});


test('Actions and Worker use the same parser and importer', async () => {
  const worker = await import('../src/stationhead-leaderboard-worker.js');
  assert.strictEqual(importLeaderboardArtifact, worker.importLeaderboardArtifact);
  assert.strictEqual(parseLeaderboardSnapshot, worker.parseLeaderboardSnapshot);
});

test('one changed ranking entry rewrites one row rather than deleting and reinserting Top 100', async () => {
  const db = createFakeDb();
  const baseRows = completeRanking({ prefix: 'stable' });
  const a = artifactWith({ ranking: baseRows }, {
    digest: 'first',
    observed_at: Date.parse('2026-09-21T15:30:00Z'),
  });
  const b = artifactWith({ ranking: baseRows.map((row, index) =>
    index === 21 ? { ...row, streams: row.streams + 10 } : row) }, {
    digest: 'one-changed',
    observed_at: Date.parse('2026-09-21T16:30:00Z'),
  });
  assert.equal((await importLeaderboardArtifact(a, db, 100)).status, 'imported');
  assert.equal(db.state.rankingInserts, 100);
  assert.equal(db.state.rankingDeletes, 0);
  const oldRows = db.state.rows.map((row) => ({ ...row }));
  const previousWrites = db.state.rankingRowWrites;
  const changed = await importLeaderboardArtifact(b, db, 200);
  assert.equal(changed.status, 'imported');
  assert.equal(db.state.rankingRowWrites - previousWrites, 1);
  assert.equal(db.state.rankingUpdates, 1);
  assert.equal(db.state.rankingDeletes, 0);
  assert.equal(db.state.rankingInserts, 100);
  assert.equal(db.state.rows[21].total_listens, baseRows[21].streams + 10);
  assert.equal(JSON.parse(db.state.rows[21].raw_json).source_digest, 'one-changed');
  assert.deepEqual(db.state.rows[0], oldRows[0], 'unchanged ranks retain their original capture record');
  assert.deepEqual(db.state.rows[99], oldRows[99]);
  assert.deepEqual(db.state.rows.map(row => row.rank), Array.from({ length: 100 }, (_, i) => i + 1));

  const after = db.state.rankingRowWrites;
  assert.equal((await importLeaderboardArtifact(b, db, 300)).status, 'unchanged');
  assert.equal(db.state.rankingRowWrites, after, 'identical retry writes no ranking rows');
});

test('rank swaps update only the changed ranks and preserve unique complete positions', async () => {
  const db = createFakeDb();
  const rows = completeRanking({ prefix: 'swappable' });
  await importLeaderboardArtifact(artifactWith({ ranking: rows }, { digest: 'swap-before' }), db, 100);
  const swapped = rows.map((row) => ({ ...row }));
  [swapped[0].name, swapped[1].name] = [swapped[1].name, swapped[0].name];
  [swapped[0].streams, swapped[1].streams] = [swapped[1].streams, swapped[0].streams];
  const before = db.state.rankingRowWrites;
  assert.equal((await importLeaderboardArtifact(artifactWith({ ranking: swapped }, {
    digest: 'swap-after', observed_at: Date.parse('2026-09-21T16:30:00Z'),
  }), db, 200)).status, 'imported');
  assert.equal(db.state.rankingRowWrites - before, 2);
  assert.equal(db.state.rankingUpdates, 2);
  assert.deepEqual(db.state.rows.slice(0, 2).map(row => row.channel_name),
    [rows[1].name, rows[0].name]);
  assert.equal(new Set(db.state.rows.map(row => row.channel_name)).size, 100);
});

test('incomplete or duplicated stored ranking rows trigger a full self-repair', async () => {
  const db = createFakeDb();
  const rows = completeRanking({ prefix: 'repair' });
  const base = artifactWith({ ranking: rows }, { digest: 'repair-before' });
  await importLeaderboardArtifact(base, db, 100);
  // Simulate an interrupted external/manual maintenance action that duplicates a rank
  // and drops another; the source checkpoint still refers to a complete Top 100.
  db.state.rows[55].rank = 54;
  const next = artifactWith({ ranking: rows.map((row, index) =>
    index === 10 ? { ...row, streams: row.streams + 1 } : row) }, {
    digest: 'repair-after', observed_at: Date.parse('2026-09-21T16:30:00Z'),
  });
  const before = db.state.rankingRowWrites;
  assert.equal((await importLeaderboardArtifact(next, db, 200)).status, 'imported');
  assert.equal(db.state.rankingRowWrites - before, 200,
    'corrupt stored ranking must be replaced rather than applying a partial update');
  assert.deepEqual(db.state.rows.map(row => row.rank), Array.from({ length: 100 }, (_, i) => i + 1));
});
