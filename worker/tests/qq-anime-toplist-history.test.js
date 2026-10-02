import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QQ_ANIME_HISTORY_PREFIX,
  filterQqAnimeSakamichiEntries,
  qqAnimeHistoryRecord,
  qqAnimeHistoryViewFromRows,
  qqAnimeHistoryIndex,
} from '../src/qq-anime-chart-history-view.js';
import {
  QQ_ANIME_HISTORY_DEFAULT_START,
  qqAnimeHistoryPeriods,
  qqAnimeHistoryToplistUrl,
} from '../scripts/backfill-qq-anime-toplist-history-actions.mjs';
import { QQ_ANIME_TOPLIST_ID, QQ_ANIME_TOPLIST_PLAYLIST_ID } from '../src/regional-music-qq.js';
import { qqAnimeToplistPreviousState } from '../scripts/collect-qq-anime-toplist-actions.mjs';

test('QQ anime history filters to the three Sakamichi groups', () => {
  const entries = filterQqAnimeSakamichiEntries([
    { position:7, track_id:'n', title:'あの光', canonical_artist:'nogizaka46', artists:[{ name:'乃木坂46' }] },
    { position:35, track_id:'s', title:'ピッカーン！', canonical_artist:'sakurazaka46', artists:[{ name:'櫻坂46' }] },
    { position:1, track_id:'x', title:'Other', canonical_artist:null, artists:[{ name:'Other' }] },
  ]);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((row) => row.canonical_artist), ['nogizaka46','sakurazaka46']);
});

test('QQ anime history records and views preserve chart ranks', () => {
  const record = qqAnimeHistoryRecord('2025_15', {
    provider_period:'2025_15',
    entries:[
      { position:42, track_id:'s', title:'ピッカーン！', canonical_artist:'sakurazaka46', artists:[{ name:'櫻坂46' }] },
    ],
  }, 123);
  const index = qqAnimeHistoryIndex({ '2025_15':{ entries:1 } }, 456);
  const view = qqAnimeHistoryViewFromRows(index, [{
    period:'2025_15', published_at:'2025-04-10', canonical_artist:'sakurazaka46', rank:42, title:'ピッカーン！', track_id:'s',
  }], 456);
  assert.equal(record.chart, 'anime_toplist');
  assert.equal(record.top_id, QQ_ANIME_TOPLIST_ID);
  assert.equal(record.entries[0].position, 42);
  assert.equal(view.history[0].rank, 42);
  assert.equal(QQ_ANIME_HISTORY_PREFIX, 'regional-music/qq_music/anime-toplist-history');
});

test('QQ anime history backfill starts at the first known available week and addresses topId 72', () => {
  assert.equal(QQ_ANIME_HISTORY_DEFAULT_START, '2020-06-01');
  const periods = qqAnimeHistoryPeriods(Date.parse('2026-10-03T00:00:00Z'));
  assert.equal(periods[0], '2026_40');
  assert.equal(periods.at(-1), '2020_23');
  const url = new URL(qqAnimeHistoryToplistUrl('2025_15'));
  const data = JSON.parse(url.searchParams.get('data'));
  assert.equal(data.req_1.param.topId, 72);
  assert.equal(data.req_1.param.period, '2025_15');
});

test('QQ anime collector reads only anime toplist membership as prior state', () => {
  const previous = qqAnimeToplistPreviousState({
    playlists:[{ service_playlist_id:QQ_ANIME_TOPLIST_PLAYLIST_ID, provider_update_time:'2025-04-10' }],
    playlist_memberships:[
      { service_playlist_id:QQ_ANIME_TOPLIST_PLAYLIST_ID, service_track_id:'s', position:42 },
      { service_playlist_id:'toplist:17', service_track_id:'j', position:1 },
    ],
  });
  assert.equal(previous.provider_update_time, '2025-04-10');
  assert.equal(previous.fingerprint, '42:s');
});
