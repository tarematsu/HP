import {
  mountMusicServiceView,
  musicServiceSakamichiFilter,
  musicServiceRankingHistoryTable,
  musicServiceRankChart,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';

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
      bodyHtml: musicServiceRankChart({ legendId: 'kugouJapanRankLegend', chartId: 'kugouJapanRankChart' }),
    }),
    musicServiceSection({
      id: 'kugouJapanHistorySection', group: 'list',
      title: '酷狗音乐 日本榜 ランクイン履歴',
      trailingHtml: musicServiceSakamichiFilter({ dataAttribute: 'kugou-artist-filter', ariaLabel: '酷狗音乐 日本榜 表示グループ' }),
      bodyHtml: musicServiceRankingHistoryTable('kugouJapanHistoryBody', '年月日'),
    }),
    musicServiceSection({
      id: 'kugouAcgChartSection',
      title: '酷狗音乐 ACG新歌榜 グループ別最高順位推移',
      bodyHtml: musicServiceRankChart({ legendId: 'kugouAcgRankLegend', chartId: 'kugouAcgRankChart' }),
    }),
    musicServiceSection({
      id: 'kugouAcgHistorySection', group: 'list',
      title: '酷狗音乐 ACG新歌榜 ランクイン履歴',
      trailingHtml: musicServiceSakamichiFilter({ dataAttribute: 'kugou-artist-filter', ariaLabel: '酷狗音乐 ACG新歌榜 表示グループ' }),
      bodyHtml: musicServiceRankingHistoryTable('kugouAcgHistoryBody'),
    }),
  ],
});