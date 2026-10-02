import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCdxRows,
  parseNeteaseJapanHtml,
  parseNeteaseJapanJson,
  selectWeeklySnapshots,
  targetForArtistNames,
} from '../scripts/investigate-netease-japan-chart-history.mjs';

test('targetForArtistNames matches current and legacy Sakamichi aliases', () => {
  assert.equal(targetForArtistNames(['櫻坂46']), 'sakurazaka46');
  assert.equal(targetForArtistNames(['欅坂46']), 'sakurazaka46');
  assert.equal(targetForArtistNames(['乃木坂46']), 'nogizaka46');
  assert.equal(targetForArtistNames(['日向坂46']), 'hinatazaka46');
  assert.equal(targetForArtistNames(['けやき坂46']), 'hinatazaka46');
  assert.equal(targetForArtistNames(['Unrelated Artist']), null);
});

test('parseNeteaseJapanJson preserves chart rank and filters Sakamichi rows', () => {
  const parsed = parseNeteaseJapanJson({
    playlist: {
      id: 60131,
      name: '日本Oricon榜',
      updateTime: 123,
      tracks: [
        { id: 1, name: 'A', ar: [{ name: 'Other' }] },
        { id: 2, name: 'B', ar: [{ name: '乃木坂46' }] },
        { id: 3, name: 'C', artists: [{ name: '櫻坂46' }] },
      ],
    },
  });
  assert.equal(parsed.chart_id, '60131');
  assert.equal(parsed.entries.length, 3);
  assert.deepEqual(parsed.matches.map((row) => [row.position, row.track_id, row.canonical_artist]), [
    [2, '2', 'nogizaka46'],
    [3, '3', 'sakurazaka46'],
  ]);
});

test('parseNeteaseJapanHtml extracts Sakamichi evidence from archived table rows', () => {
  const parsed = parseNeteaseJapanHtml(`
    <table>
      <tr><td>1</td><td><a href="/song?id=111">Other</a></td><td>Other Artist</td></tr>
      <tr><td>2</td><td><a href="/song?id=222">Same numbers</a></td><td>乃木坂46</td></tr>
    </table>
  `);
  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.matches[0].canonical_artist, 'nogizaka46');
  assert.equal(parsed.matches[0].track_id, '222');
  assert.equal(parsed.matches[0].position, 2);
});

test('parseCdxRows maps CDX tabular JSON and selectWeeklySnapshots keeps latest capture per URL/week', () => {
  const rows = parseCdxRows([
    ['timestamp', 'original', 'statuscode', 'mimetype', 'digest', 'length'],
    ['20260930010000', 'https://music.163.com/api/playlist/detail?id=60131', '200', 'application/json', 'a', '10'],
    ['20261001010000', 'https://music.163.com/api/playlist/detail?id=60131', '200', 'application/json', 'b', '11'],
    ['20261002010000', 'https://music.163.com/api/playlist/detail?id=60131', '200', 'application/json', 'c', '12'],
  ]);
  assert.equal(rows.length, 3);
  const selected = selectWeeklySnapshots(rows);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].timestamp, '20261002010000');
});
