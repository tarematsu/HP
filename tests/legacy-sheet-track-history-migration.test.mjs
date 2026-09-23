import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../database/facts-migrations/054_legacy_spreadsheet_track_history.sql', import.meta.url),
  'utf8',
);

test('legacy spreadsheet track-history seed uses the 09:00 JST reporting day', () => {
  assert.match(migration, /09:00 JST \(= 00:00 UTC\).*08:59 JST/s);
  assert.match(migration, /no title-evidence\s+-- gap longer than five minutes/s);

  const daysMatch = migration.match(/FROM json_each\('(\[\[1,"2025-06-06".*?\]\])'\)\s*\),\s*tracks AS/s);
  assert.ok(daysMatch, 'seeded day payload is missing');
  const days = JSON.parse(daysMatch[1].replaceAll("''", "'"));
  assert.equal(days.length, 33);
  assert.equal(days[0][1], '2025-06-06');
  assert.equal(days.at(-1)[1], '2025-07-29');
});

test('legacy spreadsheet track-history seed preserves the verified aggregate totals', () => {
  const packedMatch = migration.match(/VALUES\('([0-9A-F]+)'\)\s*\),\s*positions/s);
  assert.ok(packedMatch, 'packed play payload is missing');
  const packed = packedMatch[1];
  assert.equal(packed.length % 6, 0);
  assert.equal(packed.length / 6, 1822);

  let playCount = 0;
  for (let offset = 0; offset < packed.length; offset += 6) {
    playCount += Number.parseInt(packed.slice(offset + 4, offset + 6), 16);
  }
  assert.equal(playCount, 14119);
});

test('legacy spreadsheet rows are protected from later ordinary track-history cleanup', () => {
  assert.match(migration, /row_key LIKE 'legacy-sheet\|%'/);
  assert.match(migration, /CREATE TRIGGER trg_preserve_legacy_sheet_track_history/);
  assert.match(migration, /BEFORE DELETE ON sh_pages_track_history_read_model/);
  assert.match(migration, /SELECT RAISE\(IGNORE\)/);
  assert.match(migration, /'source','legacy_google_sheet'/);
});
