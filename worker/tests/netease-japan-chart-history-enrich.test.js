import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichHistoricalMatches,
  extractNeteasePreloadedSongs,
  structuredMatchesFromArchivedHtml,
} from '../scripts/enrich-netease-japan-history-report.mjs';

const archivedHtml = `
<html><body>
<textarea id="song-list-pre-data">[
  {&quot;id&quot;:11,&quot;name&quot;:&quot;Other&quot;,&quot;artists&quot;:[{&quot;name&quot;:&quot;Other Artist&quot;}]},
  {&quot;id&quot;:22,&quot;name&quot;:&quot;裸足でSummer&quot;,&quot;artists&quot;:[{&quot;name&quot;:&quot;乃木坂46&quot;}]},
  {&quot;id&quot;:33,&quot;name&quot;:&quot;世界には愛しかない&quot;,&quot;artists&quot;:[{&quot;name&quot;:&quot;欅坂46&quot;}]}
]</textarea>
</body></html>`;

test('extractNeteasePreloadedSongs parses archived song-list-pre-data JSON', () => {
  const tracks = extractNeteasePreloadedSongs(archivedHtml);
  assert.equal(tracks.length, 3);
  assert.equal(tracks[1].name, '裸足でSummer');
});

test('structuredMatchesFromArchivedHtml recovers exact array-order rank', () => {
  const matches = structuredMatchesFromArchivedHtml(archivedHtml);
  assert.deepEqual(matches.map((row) => [row.position, row.track_id, row.title, row.canonical_artist]), [
    [2, '22', '裸足でSummer', 'nogizaka46'],
    [3, '33', '世界には愛しかない', 'sakurazaka46'],
  ]);
});

test('enrichHistoricalMatches replaces fallback evidence with structured chart rows', async () => {
  const report = {
    archive: {
      matches: [
        { timestamp:'20160903072427', iso_week:'2016_35', archive_url:'https://archive.test/a', original_url:'http://music.163.com/discover/toplist?id=60131', canonical_artist:'nogizaka46' },
        { timestamp:'20160903072427', iso_week:'2016_35', archive_url:'https://archive.test/a', original_url:'http://music.163.com/discover/toplist?id=60131', canonical_artist:'sakurazaka46' },
      ],
    },
  };
  const enriched = await enrichHistoricalMatches(report, async () => archivedHtml);
  assert.equal(enriched.archive.enrichment.exact_snapshots, 1);
  assert.equal(enriched.archive.enrichment.fallback_snapshots, 0);
  assert.deepEqual(enriched.archive.counts, { sakurazaka46:1, nogizaka46:1, hinatazaka46:0 });
  assert.deepEqual(enriched.archive.matches.map((row) => [row.position, row.title]), [[2, '裸足でSummer'], [3, '世界には愛しかない']]);
});
