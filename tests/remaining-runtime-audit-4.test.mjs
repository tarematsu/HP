import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadHistoricalListeningPartyRows } from '../site/functions/lib/listening-party-historical.js';

function jsonRows(rows) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async all() {
              if (sql.includes('listening_party_historical')) return { results: rows.historical || [] };
              if (sql.includes('listening_party_fail_safe')) return { results: rows.failSafe || [] };
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

test('historical listening parties preserve samples and summary-only rows', async () => {
  const db = jsonRows({
    historical: [
      {
        event_name: 'event-a',
        started_at: 1_000,
        ended_at: 2_000,
        source: 'google_sheets_canonical',
        samples_json: JSON.stringify([{ minute: 0, listener: 30 }]),
      },
      {
        event_name: 'event-b',
        started_at: 3_000,
        ended_at: 4_000,
        source: 'historical_summary_only',
        samples_json: '[]',
      },
    ],
    failSafe: [],
  });
  const loaded = await loadHistoricalListeningPartyRows(db, { fromMs: 0, toMs: 10_000 });
  assert.equal(loaded.historical.length, 2);
  assert.equal(loaded.historical[0].source, 'google_sheets_canonical');
  assert.equal(loaded.historical[0].samples[0].listener, 30);
  assert.equal(loaded.historical[1].source, 'historical_summary_only');
  assert.deepEqual(loaded.historical[1].samples, []);
  assert.deepEqual(loaded.failSafe, []);
});

test('history client owns table formatting and cache while charts are mode-specific', () => {
  const source = readFileSync(
    new URL('../site/public/history/history-lite.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /integerFormat as integer/);
  assert.doesNotMatch(source, /const integer = new Intl\.NumberFormat/);
  assert.match(source, /const dateOnly = new Intl\.DateTimeFormat/);
  assert.match(source, /function renderTable/);
  assert.match(source, /function publishHistoryData/);
  assert.match(source, /history:data-loaded/);
  assert.match(source, /sessionStorage\.getItem/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.doesNotMatch(source, /function drawSummaryChart|function prepareCanvas|chartModel|broadcast-series|history-current|mode === 'raw'/);
  assert.doesNotMatch(source, /TRACK_COLUMNS|trackDate|trackWeekMode|mode === 'tracks'/);
});
