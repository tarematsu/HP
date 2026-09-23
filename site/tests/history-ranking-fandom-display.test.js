import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadRanking } from '../functions/lib/history-ranking.js';

function rankingRows({ withFandom = true } = {}) {
  const metadata = withFandom ? {
    artist_name: '櫻坂46',
    fandom_type: 'fandom',
    fandom_label: '櫻坂46(ファンダム)',
  } : {
    artist_name: null,
    fandom_type: null,
    fandom_label: null,
  };
  return [
    {
      ranking_date: '2026-09-07',
      ranking_type: '週間リーダーボード',
      rank: 10,
      host_name: 'sakuramankai',
      host_alias: 'sakuramankai',
      ...metadata,
    },
    {
      ranking_date: '2026-09-21',
      ranking_type: '週間リーダーボード',
      rank: 8,
      host_name: 'sakuramankai',
      host_alias: 'sakuramankai',
      ...metadata,
    },
  ];
}

function dbFor({ withFandom = true } = {}) {
  const rows = rankingRows({ withFandom });
  const gapMetadata = withFandom ? {
    artist_name: '櫻坂46',
    fandom_type: 'fandom',
    fandom_label: '櫻坂46(ファンダム)',
  } : {
    artist_name: null,
    fandom_type: null,
    fandom_label: null,
  };
  const model = {
    version: 1,
    refreshed_at: 1_790_000_000_000,
    source_max_ranking_date: '2026-09-21',
    ranking_weeks: ['2026-09-07', '2026-09-14', '2026-09-21'],
    actual_rows: rows,
    completed_rows: [
      rows[0],
      {
        ranking_date: '2026-09-14',
        observed_at: Date.parse('2026-09-14T00:00:00Z'),
        ranking_type: '週間リーダーボード',
        rank: null,
        host_name: 'sakuramankai',
        host_alias: 'sakuramankai',
        source_sheet: null,
        quality_score: null,
        quality_flags: 'not_listed',
        synthetic: true,
        is_out_of_rank: true,
        ...gapMetadata,
      },
      rows[1],
    ],
    weekly_metrics: [],
  };
  return {
    prepare(sql) {
      assert.match(sql, /FROM sh_weekly_ranking_read_model/);
      return {
        async first() {
          return {
            payload_json: JSON.stringify(model),
            source_max_ranking_date: model.source_max_ranking_date,
            refreshed_at: model.refreshed_at,
          };
        },
      };
    },
  };
}

function request() {
  return new URL('https://example.test/api/history?mode=ranking&scope=all&host=sakuramankai&from=2026-09-07&to=2026-09-21');
}

test('ranking API exposes materialized fandom metadata in rows, host summaries, and synthetic gap weeks', async () => {
  const response = await loadRanking(request(), { OTHER_DB: dbFor() });
  const data = await response.json();

  assert.equal(data.rows.length, 3);
  assert.ok(data.rows.every((row) => row.fandom_label === '櫻坂46(ファンダム)'));
  assert.equal(data.rows.find((row) => row.synthetic)?.artist_name, '櫻坂46');
  assert.equal(data.host_rankings[0].artist_name, '櫻坂46');
  assert.equal(data.host_rankings[0].fandom_type, 'fandom');
  assert.equal(data.host_rankings[0].fandom_label, '櫻坂46(ファンダム)');
});

test('ranking data remains available when the materialized model has no fandom metadata', async () => {
  const response = await loadRanking(request(), { OTHER_DB: dbFor({ withFandom: false }) });
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
