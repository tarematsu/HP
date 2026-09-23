import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadRanking } from '../functions/lib/history-ranking.js';

const summaryLoader = async () => ({
  rows: [],
  live_overlay_count: 0,
  latest_live_observed_at: null,
});

function dbFor(actualRows, { fandomTableMissing = false } = {}) {
  return {
    prepare(sql) {
      const execute = async () => {
        if (sql.includes('GROUP_CONCAT(DISTINCT channel_alias)')) {
          return {
            results: [{
              host_name: 'sakuramankai',
              host_aliases: 'sakuramankai',
              first_ranking_date: '2026-09-07',
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT ranking_date')) {
          return {
            results: [
              { ranking_date: '2026-09-07' },
              { ranking_date: '2026-09-21' },
            ],
          };
        }
        if (sql.includes('FROM sh_channel_fandoms')) {
          if (fandomTableMissing) throw new Error('no such table: sh_channel_fandoms');
          return {
            results: [{
              host_name: 'sakuramankai',
              artist_name: '櫻坂46',
              relation_type: 'fandom',
            }],
          };
        }
        if (sql.includes('FROM sh_channel_rankings r')) return { results: actualRows };
        throw new Error(`unexpected SQL: ${sql}`);
      };
      return {
        bind() {
          return { all: execute };
        },
        all: execute,
      };
    },
  };
}

function rankingRows() {
  return [
    {
      ranking_date: '2026-09-07',
      ranking_type: '週間リーダーボード',
      rank: 10,
      host_name: 'sakuramankai',
      host_alias: 'sakuramankai',
    },
    {
      ranking_date: '2026-09-21',
      ranking_type: '週間リーダーボード',
      rank: 8,
      host_name: 'sakuramankai',
      host_alias: 'sakuramankai',
    },
  ];
}

function request() {
  return new URL('https://example.test/api/history?mode=ranking&scope=all&host=sakuramankai&from=2026-09-07&to=2026-09-21');
}

test('ranking API exposes fandom metadata in rows, host summaries, and synthetic gap weeks', async () => {
  const response = await loadRanking(request(), { OTHER_DB: dbFor(rankingRows()) }, summaryLoader);
  const data = await response.json();

  assert.equal(data.rows.length, 3);
  assert.ok(data.rows.every((row) => row.fandom_label === '櫻坂46(ファンダム)'));
  assert.equal(data.rows.find((row) => row.synthetic)?.artist_name, '櫻坂46');
  assert.equal(data.host_rankings[0].artist_name, '櫻坂46');
  assert.equal(data.host_rankings[0].fandom_type, 'fandom');
  assert.equal(data.host_rankings[0].fandom_label, '櫻坂46(ファンダム)');
});

test('ranking data remains available before the fandom metadata migration is applied', async () => {
  const response = await loadRanking(
    request(),
    { OTHER_DB: dbFor(rankingRows(), { fandomTableMissing: true }) },
    summaryLoader,
  );
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.setup_required, undefined);
  assert.equal(data.rows.length, 3);
  assert.ok(data.rows.every((row) => row.fandom_label == null));
});

test('ranking table cleanup inserts fandom immediately after host and keeps a four-column mobile layout', () => {
  const source = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');
  assert.match(source, /fandomHeader\.textContent = 'ファンダム'/);
  assert.match(source, /headers\[hostIndex\]\.after\(fandomHeader\)/);
  assert.match(source, /hostCell\.after\(fandomCell\)/);
  assert.match(source, /nth-child\(4\)/);
});

test('D1 migration stores artist and relationship type per Stationhead host', () => {
  const migration = readFileSync(
    new URL('../../database/other-migrations/028_channel_fandom_metadata.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_channel_fandoms/);
  assert.match(migration, /idx_sh_channel_fandoms_host_normalized/);
  assert.match(migration, /'sakuramankai'[\s\S]*'櫻坂46'[\s\S]*'fandom'/);
  assert.match(migration, /'sakurazaka46jp'[\s\S]*'櫻坂46'[\s\S]*'official'/);
});
