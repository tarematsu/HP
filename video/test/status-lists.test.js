import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  attachListItems,
  parseStatusListLimit,
  readBlocklistStatus,
  STATUS_LIST_DEFAULT_LIMIT,
  STATUS_LIST_MAX_LIMIT,
  unpackStatusItems
} from '../src/status-lists.js';

function createStatusDb(items, blockedVideos, countsDirty = 0) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        sql: sql.replace(/\s+/g, ' ').trim(),
        bind(...args) {
          this.args = args;
          return this;
        },
        async all() {
          statements.push(this);
          return { results: items };
        },
        async first() {
          statements.push(this);
          return {
            blockedVideos,
            deathVideos: 2,
            countsDirty,
            countsUpdatedAt: '2026-07-19T00:00:00.000Z'
          };
        }
      };
    }
  };
}

test('status list limit defaults and clamps safely', () => {
  assert.equal(parseStatusListLimit(undefined), STATUS_LIST_DEFAULT_LIMIT);
  assert.equal(parseStatusListLimit('not-a-number'), STATUS_LIST_DEFAULT_LIMIT);
  assert.equal(parseStatusListLimit('0'), 1);
  assert.equal(parseStatusListLimit('25'), 25);
  assert.equal(parseStatusListLimit('9999'), STATUS_LIST_MAX_LIMIT);
});

test('status item results are returned without helper count fields', () => {
  assert.deepEqual(unpackStatusItems({
    results: [
      { canonicalKey: 'one' },
      { canonicalKey: 'two' }
    ]
  }), [
    { canonicalKey: 'one' },
    { canonicalKey: 'two' }
  ]);
  assert.deepEqual(unpackStatusItems({ results: [] }), []);
});

test('status list metadata reports returned and truncated entries', () => {
  const items = [{ canonicalKey: 'one' }, { canonicalKey: 'two' }];
  assert.deepEqual(attachListItems({ count: 3, type: 'test' }, items, 2), {
    count: 3,
    type: 'test',
    limit: 2,
    returnedCount: 2,
    truncated: true,
    items
  });
});

test('full BAD list page reads the persisted singleton to detect truncation', async () => {
  const db = createStatusDb([{ canonicalKey: 'bad-one' }], 3);
  const report = await readBlocklistStatus(db, 1);

  assert.equal(db.statements.length, 2);
  assert.equal(db.statements[0].sql.includes('ORDER BY blocked_at'), true);
  assert.equal(db.statements[1].sql.includes('FROM status_counts WHERE id = 1'), true);
  assert.equal(db.statements[1].sql.includes('COUNT('), false);
  assert.equal(report.count, 3);
  assert.equal(report.returnedCount, 1);
  assert.equal(report.truncated, true);
  assert.equal(report.stale, false);
  assert.equal(report.ok, true);
});

test('dirty persisted counts are returned stale without synchronous rebuild', async () => {
  const db = createStatusDb([{ canonicalKey: 'bad-one' }], 3, 1);
  const report = await readBlocklistStatus(db, 1);

  assert.equal(db.statements.length, 2);
  assert.equal(db.statements.some(item => item.sql.includes('COUNT(*)')), false);
  assert.equal(report.count, 3);
  assert.equal(report.stale, true);
  assert.equal(report.repair, 'daily-cleanup');
  assert.equal(report.ok, false);
});

test('short BAD list page derives the total without a count read', async () => {
  const db = createStatusDb([{ canonicalKey: 'bad-one' }], 99);
  const report = await readBlocklistStatus(db, 5);

  assert.equal(db.statements.length, 1);
  assert.equal(db.statements[0].sql.includes('ORDER BY blocked_at'), true);
  assert.equal(report.count, 1);
  assert.equal(report.returnedCount, 1);
  assert.equal(report.truncated, false);
  assert.equal(report.stale, false);
});

test('status list hot paths contain no direct or deferred full count scans', async () => {
  const source = await readFile(new URL('../src/status-lists.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /SELECT COUNT\(\*\) AS count FROM video_blocklist/);
  assert.doesNotMatch(source, /SELECT COUNT\(\*\) AS count FROM video_death_list/);
  assert.doesNotMatch(source, /refreshStatusCounts/);
  assert.match(source, /prepareStatusCountsRead/);
  assert.match(source, /daily-cleanup/);
});
