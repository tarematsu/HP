import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { splitUtf8String } from '../worker/scripts/materialize-weekly-ranking-read-model.mjs';

test('weekly ranking payload chunks round-trip without splitting unicode code points', () => {
  const source = JSON.stringify({
    rows: Array.from({ length: 12000 }, (_, index) => ({
      index,
      host: `host-${index}`,
      label: index % 2 ? '櫻坂46(ファンダム)' : '😀 weekly leaderboard',
    })),
  });
  const chunks = splitUtf8String(source, 32 * 1024);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), source);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 32 * 1024));
});

test('weekly ranking chunk migration and required-table contract stay in sync', () => {
  const migration = readFileSync('database/other-migrations/038_weekly_ranking_read_model_chunks.sql', 'utf8');
  const contract = readFileSync('worker/scripts/other-db-tables.mjs', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_weekly_ranking_read_model_chunks/);
  assert.match(migration, /PRIMARY KEY\(generation_id, chunk_index\)/);
  assert.match(contract, /'sh_weekly_ranking_read_model_chunks'/);
});
