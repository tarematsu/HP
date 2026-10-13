import {
  mountMusicServiceView,
  musicServiceRegionalChartPair,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';

const popularityTable = musicServiceTable({
  className: 'music-service-popularity-table',
  wrapClassName: 'music-service-table-wrap',
  headers: ['グループ', '順位', '曲名'],
  bodyId: 'qqArtistPopularityBody',
});

const rankingSections = [
  {
    chartSectionId: 'qqJapanChartSection', group: 'japan',
    historySectionId: 'qqJapanHistorySection',
    chartTitle: 'QQ音乐 日本榜 グループ別最高順位推移',
    historyTitle: 'QQ音乐 日本榜 ランクイン履歴',
    chartId: 'qqJapanRankChart',
    legendId: 'qqJapanRankLegend',
    historyBodyId: 'qqJapanHistoryBody',
    filterAriaLabel: 'QQ音乐 日本榜 表示グループ',
  },
  {
    chartSectionId: 'qqAnimeChartSection', group: 'anime',
    historySectionId: 'qqAnimeHistorySection',
    chartTitle: 'QQ音乐 动漫音乐榜 グループ別最高順位推移',
    historyTitle: 'QQ音乐 动漫音乐榜 ランクイン履歴',
    chartId: 'qqAnimeRankChart',
    legendId: 'qqAnimeRankLegend',
    historyBodyId: 'qqAnimeHistoryBody',
    filterAriaLabel: 'QQ音乐 动漫音乐榜 表示グループ',
  },
].flatMap((config) => musicServiceRegionalChartPair({
  ...config,
  filterAttribute: 'qq-artist-filter',
}));

mountMusicServiceView({
  viewId: 'qqMusicView',
  className: 'qq-music-view',
  groupLabels: { japan: '日本榜', anime: 'アニメ榜', popular: '人気曲' },
  noticeId: 'qqMusicNotice',
  meta: {
    valueId: 'qqMusicUpdatedAt',
    cadenceId: 'qqMusicCadence',
  },
  sections: [
    ...rankingSections,
    musicServiceSection({
      id: 'qqArtistPopularitySection',
      group: 'popular',
      title: 'QQ音乐 アーティスト別人気曲順位',
      bodyHtml: '<div id="qqPopularityChart"></div>' + popularityTable,
    }),
  ],
});
