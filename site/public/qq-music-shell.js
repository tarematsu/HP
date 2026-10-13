import {
  mountMusicServiceView,
  musicServiceSakamichiFilter,
  musicServiceRankingHistoryTable,
  musicServiceRankChart,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';

const popularityTable = musicServiceTable({
  className: 'music-service-popularity-table',
  wrapClassName: 'music-service-table-wrap',
  headers: ['グループ', '順位', '曲名'],
  bodyId: 'qqArtistPopularityBody',
});

mountMusicServiceView({
  viewId: 'qqMusicView',
  className: 'qq-music-view',
  noticeId: 'qqMusicNotice',
  meta: {
    valueId: 'qqMusicUpdatedAt',
    cadenceId: 'qqMusicCadence',
  },
  sections: [
    musicServiceSection({
      id: 'qqJapanChartSection',
      title: 'QQ音乐 日本榜 グループ別最高順位推移',
      bodyHtml: musicServiceRankChart({ legendId: 'qqJapanRankLegend', chartId: 'qqJapanRankChart' }),
    }),
    musicServiceSection({
      id: 'qqJapanHistorySection', group: 'list',
      title: 'QQ音乐 日本榜 ランクイン履歴',
      trailingHtml: musicServiceSakamichiFilter({ dataAttribute: 'qq-artist-filter', ariaLabel: 'QQ音乐 日本榜 表示グループ' }),
      bodyHtml: musicServiceRankingHistoryTable('qqJapanHistoryBody'),
    }),
    musicServiceSection({
      id: 'qqAnimeChartSection',
      title: 'QQ音乐 动漫音乐榜 グループ別最高順位推移',
      bodyHtml: musicServiceRankChart({ legendId: 'qqAnimeRankLegend', chartId: 'qqAnimeRankChart' }),
    }),
    musicServiceSection({
      id: 'qqAnimeHistorySection', group: 'list',
      title: 'QQ音乐 动漫音乐榜 ランクイン履歴',
      trailingHtml: musicServiceSakamichiFilter({ dataAttribute: 'qq-artist-filter', ariaLabel: 'QQ音乐 动漫音乐榜 表示グループ' }),
      bodyHtml: musicServiceRankingHistoryTable('qqAnimeHistoryBody'),
    }),
    musicServiceSection({
      id: 'qqArtistPopularitySection', group: 'list',
      title: 'QQ音乐 アーティスト別人気曲順位',
      bodyHtml: popularityTable,
    }),
  ],
});