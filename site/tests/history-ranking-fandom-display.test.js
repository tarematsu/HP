import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadRanking } from '../functions/lib/history-ranking.js';

const summaryLoader = async () => ({
  rows: [],
  live_overlay_count: 0,
  latest_live_observed_at: null,
});

function dbFor(actualRows, { fandomTableMissing = false, channelColumnMissing = false } = {}) {
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
          if (channelColumnMissing && sql.includes('stationhead_channel_name')) {
            throw new Error('no such column: stationhead_channel_name');
          }
          return {
            results: [{
              host_name: 'sakuramankai',
              artist_name: '櫻坂46',
              relation_type: 'fandom',
              ...(channelColumnMissing ? {} : { stationhead_channel_name: 'Buddies' }),
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

test('ranking API exposes channel, artist, and relation separately in rows and host summaries', async () => {
  const response = await loadRanking(request(), { OTHER_DB: dbFor(rankingRows()) }, summaryLoader);
  const data = await response.json();

  assert.equal(data.rows.length, 3);
  assert.ok(data.rows.every((row) => row.fandom_label === '櫻坂46'));
  assert.ok(data.rows.every((row) => row.stationhead_channel_name === 'Buddies'));
  assert.ok(data.rows.every((row) => row.relation_label === 'ファンダム'));
  assert.equal(data.rows.find((row) => row.synthetic)?.artist_name, '櫻坂46');
  assert.equal(data.host_rankings[0].stationhead_channel_name, 'Buddies');
  assert.equal(data.host_rankings[0].artist_name, '櫻坂46');
  assert.equal(data.host_rankings[0].fandom_type, 'fandom');
  assert.equal(data.host_rankings[0].relation_label, 'ファンダム');
  assert.equal(data.host_rankings[0].fandom_label, '櫻坂46');
});

test('ranking data remains available before the channel metadata column is applied', async () => {
  const response = await loadRanking(
    request(),
    { OTHER_DB: dbFor(rankingRows(), { channelColumnMissing: true }) },
    summaryLoader,
  );
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.setup_required, undefined);
  assert.equal(data.rows.length, 3);
  assert.ok(data.rows.every((row) => row.artist_name === '櫻坂46'));
  assert.ok(data.rows.every((row) => row.stationhead_channel_name == null));
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

test('ranking table cleanup inserts channel, artist, and official columns after host', () => {
  const source = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');
  assert.match(source, /channelHeader\.textContent = 'チャンネル'/);
  assert.match(source, /artistHeader\.textContent = 'アーティスト名'/);
  assert.match(source, /relationHeader\.textContent = '公式'/);
  assert.match(source, /headers\[hostIndex\]\.after\(channelHeader, artistHeader, relationHeader\)/);
  assert.match(source, /hostCell\.after\(channelCell, artistCell, relationCell\)/);
  assert.match(source, /nth-child\(6\)/);
  assert.doesNotMatch(source, /\$\{artist\}\(\$\{/);
});

test('D1 migrations store channel metadata and correct sbuddies1819 to SB19 ATIN', () => {
  const baseMigration = readFileSync(
    new URL('../../database/other-migrations/028_channel_fandom_metadata.sql', import.meta.url),
    'utf8',
  );
  const channelMigration = readFileSync(
    new URL('../../database/other-migrations/037_stationhead_channel_metadata.sql', import.meta.url),
    'utf8',
  );
  assert.match(baseMigration, /CREATE TABLE IF NOT EXISTS sh_channel_fandoms/);
  assert.match(baseMigration, /idx_sh_channel_fandoms_host_normalized/);
  assert.match(channelMigration, /ADD COLUMN stationhead_channel_name TEXT/);
  assert.match(channelMigration, /WHEN '櫻坂46' THEN 'Buddies'/);
  assert.match(channelMigration, /WHERE lower\(host_name\) = 'sbuddies1819'/);
  assert.match(channelMigration, /artist_name = 'SB19'[\s\S]*stationhead_channel_name = 'ATIN'/);
});
