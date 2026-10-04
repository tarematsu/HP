import {
  mountMusicServiceView,
  musicServiceFilterTabs,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';

function artistFilter(label) {
  return musicServiceFilterTabs([
    { value: 'all', label: 'すべて', active: true },
    { value: 'sakurazaka46', label: '櫻坂' },
    { value: 'nogizaka46', label: '乃木坂' },
    { value: 'hinatazaka46', label: '日向坂' },
  ], {
    dataAttribute: 'kugou-artist-filter',
    ariaLabel: label,
  });
}

function historyTable(bodyId, dateLabel) {
  return musicServiceTable({
    className: 'music-service-history-table',
    wrapClassName: 'music-service-table-wrap',
    headers: [dateLabel, 'グループ', '順位', '曲名'],
    bodyId,
  });
}

mountMusicServiceView({
  viewId: 'kugouMusicView',
  className: 'kugou-music-view',
  noticeId: 'kugouMusicNotice',
  meta: {
    valueId: 'kugouMusicUpdatedAt',
    cadenceId: 'kugouMusicCadence',
  },
  sections: [
    musicServiceSection({
      id: 'kugouJapanChartSection',
      title: '酷狗音乐 日本榜 グループ別最高順位推移',
      bodyHtml: '<div id="kugouJapanRankLegend" class="music-service-rank-legend" aria-label="グループ凡例"></div><div id="kugouJapanRankChart" class="music-service-rank-chart"></div>',
    }),
    musicServiceSection({
      id: 'kugouJapanHistorySection', group: 'list',
      title: '酷狗音乐 日本榜 ランクイン履歴',
      trailingHtml: artistFilter('酷狗音乐 日本榜 表示グループ'),
      bodyHtml: historyTable('kugouJapanHistoryBody', '年月日'),
    }),
    musicServiceSection({
      id: 'kugouAcgChartSection',
      title: '酷狗音乐 ACG新歌榜 グループ別最高順位推移',
      bodyHtml: '<div id="kugouAcgRankLegend" class="music-service-rank-legend" aria-label="グループ凡例"></div><div id="kugouAcgRankChart" class="music-service-rank-chart"></div>',
    }),
    musicServiceSection({
      id: 'kugouAcgHistorySection', group: 'list',
      title: '酷狗音乐 ACG新歌榜 ランクイン履歴',
      trailingHtml: artistFilter('酷狗音乐 ACG新歌榜 表示グループ'),
      bodyHtml: historyTable('kugouAcgHistoryBody', '更新日'),
    }),
  ],
});