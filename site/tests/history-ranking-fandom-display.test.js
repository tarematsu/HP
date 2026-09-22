import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadRanking } from '../functions/lib/history-ranking.js';

const summaryLoader = async () => ({
  rows: [],
  live_overlay_count: 0,
  latest_live_observed_at: null,
});

function dbFor(actualRows) {
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

test('ranking API exposes a formatted fandom label and carries it into synthetic gap weeks', async () => {
  const actualRows = [
    {
      ranking_date: '2026-09-07',
      ranking_type: '週間リーダーボード',
      rank: 10,
      host_name: 'sakuramankai',
      host_alias: 'sakuramankai',
      artist_name: '櫻坂46',
      fandom_type: 'fandom',
    },
    {
      ranking_date: '2026-09-21',
      ranking_type: '週間リーダーボード',
      rank: 8,
      host_name: 'sakuramankai',
      host_alias: 'sakuramankai',
      artist_name: '櫻坂46',
      fandom_type: 'fandom',
    },
  ];
  const url = new URL('https://example.test/api/history?mode=ranking&scope=all&host=sakuramankai&from=2026-09-07&to=2026-09-21');
  const response = await loadRanking(url, { OTHER_DB: dbFor(actualRows) }, summaryLoader);
  const data = await response.json();

  assert.equal(data.rows.length, 3);
  assert.ok(data.rows.every((row) => row.fandom_label === '櫻坂46(ファンダム)'));
  assert.equal(data.rows.find((row) => row.synthetic)?.artist_name, '櫻坂46');
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
  assert.match(migration, /'sakuramankai'[\s\S]*'櫻坂46'[\s\S]*'fandom'/);
  assert.match(migration, /'sakurazaka46jp'[\s\S]*'櫻坂46'[\s\S]*'official'/);
});
