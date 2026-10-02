import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalMelonJpopHistoryArtist,
  melonCompletedMonthlyPeriods,
  melonCompletedWeeklyPeriods,
  melonJpopHistoryView,
  melonJpopMonthlyUrl,
  melonJpopWeeklyUrl,
  melonMonthlyUrlCandidates,
  melonWeeklyUrlCandidates,
  parseMelonJpopHistoryEntries,
  parseMelonMonthlyPeriod,
  parseMelonWeeklyPeriod,
} from '../src/melon-jpop-history.js';
import { collectMelonHistoricalPeriod } from '../scripts/backfill-melon-jpop-history-actions.mjs';

test('Melon history recognizes current and legacy Sakamichi artist names', () => {
  assert.equal(canonicalMelonJpopHistoryArtist('櫻坂46'), 'sakurazaka46');
  assert.equal(canonicalMelonJpopHistoryArtist('Nogizaka46'), 'nogizaka46');
  assert.equal(canonicalMelonJpopHistoryArtist('히나타자카46'), 'hinatazaka46');
  assert.equal(canonicalMelonJpopHistoryArtist('欅坂46'), 'keyakizaka46');
  assert.equal(canonicalMelonJpopHistoryArtist('Hiragana Keyakizaka46'), 'hiragana_keyakizaka46');
  assert.equal(canonicalMelonJpopHistoryArtist('Other Artist'), null);
});

test('Melon history parses only Sakamichi rows with absolute ranks', () => {
  const html = `
    <table><tbody>
      <tr data-song-no="101"><td><span class="rank">8</span></td><td><div class="ellipsis rank01"><a>Song A</a></div></td><td><div class="ellipsis rank02"><a>乃木坂46</a></div></td><td><div class="ellipsis rank03"><a>Album A</a></div></td></tr>
      <tr data-song-no="102"><td><span class="rank">22</span></td><td><div class="ellipsis rank01"><a>Song B</a></div></td><td><div class="ellipsis rank02"><a>欅坂46</a></div></td><td><div class="ellipsis rank03"><a>Album B</a></div></td></tr>
      <tr data-song-no="103"><td><span class="rank">44</span></td><td><div class="ellipsis rank01"><a>Other</a></div></td><td><div class="ellipsis rank02"><a>Other Artist</a></div></td></tr>
    </tbody></table>`;
  assert.deepEqual(parseMelonJpopHistoryEntries(html), [
    { canonical_artist:'nogizaka46', position:8, track_id:'101', title:'Song A', album_name:'Album A', artist_text:'乃木坂46' },
    { canonical_artist:'keyakizaka46', position:22, track_id:'102', title:'Song B', album_name:'Album B', artist_text:'欅坂46' },
  ]);
});

test('Melon historical chart URLs use J-pop and explicit periods', () => {
  assert.equal(
    melonJpopWeeklyUrl('2024-01-01', '2024-01-07'),
    'https://www.melon.com/chart/week/index.htm?classCd=GN1900&moved=Y&startDay=20240101&endDay=20240107',
  );
  assert.equal(
    melonJpopMonthlyUrl('2024-01'),
    'https://www.melon.com/chart/month/index.htm?classCd=GN1900&moved=Y&rankMonth=202401',
  );
  assert.match(melonWeeklyUrlCandidates('2016-01-04', '2016-01-10')[0], /classCd=GN1900/);
  assert.match(melonMonthlyUrlCandidates('2016-01')[0], /classCd=GN1900/);
});

test('Melon historical period parsers read provider-selected period', () => {
  assert.deepEqual(
    parseMelonWeeklyPeriod('<div>2024.01.01 ~ 2024.01.07 J-pop</div>'),
    { start:'2024-01-01', end:'2024-01-07' },
  );
  assert.equal(parseMelonMonthlyPeriod('<div>월간 2024.01 J-pop</div>'), '2024-01');
});

test('Melon history period generators include completed weeks and months only', () => {
  const now = Date.parse('2026-10-03T00:00:00Z');
  const weeks = melonCompletedWeeklyPeriods('2026-09-20', now);
  assert.deepEqual(weeks, [{
    type:'week',
    period:'2026-09-21_2026-09-27',
    start:'2026-09-21',
    end:'2026-09-27',
  }]);
  const months = melonCompletedMonthlyPeriods('2026-08-01', now);
  assert.deepEqual(months.map((item) => item.period), ['2026-08','2026-09']);
});

test('historical collector rejects a response for the wrong provider period', async () => {
  const fetchImpl = async () => ({
    ok:true,
    async text() {
      return '<div>2026.09.21 ~ 2026.09.27</div><table><tr data-song-no="101"><td><span class="rank">1</span></td><td><div class="rank01"><a>Song</a></div></td><td><div class="rank02"><a>乃木坂46</a></div></td></tr></table>';
    },
  });
  const record = await collectMelonHistoricalPeriod({
    type:'week', period:'2024-01-01_2024-01-07', start:'2024-01-01', end:'2024-01-07',
  }, fetchImpl);
  assert.equal(record.status, 'error');
  assert.deepEqual(record.entries, []);
  assert.match(record.error, /period mismatch/);
});

test('Melon history view preserves empty checked periods and legacy groups', () => {
  const view = melonJpopHistoryView([
    { type:'week', period:'2016-04-18_2016-04-24', start:'2016-04-18', end:'2016-04-24', status:'ok', source_url:'x', entries:[
      { canonical_artist:'keyakizaka46', position:12, track_id:'1', title:'サイレントマジョリティー', album_name:'', artist_text:'欅坂46' },
    ] },
    { type:'week', period:'2016-04-25_2016-05-01', start:'2016-04-25', end:'2016-05-01', status:'ok', source_url:'y', entries:[] },
  ], 1234);
  assert.equal(view.coverage.week.checked_periods, 2);
  assert.equal(view.coverage.week.entries, 1);
  assert.equal(view.history[0].canonical_artist, 'keyakizaka46');
  assert.equal(view.periods[1].entries, 0);
});
