import {
  mountMusicServiceView,
  musicServiceRegionalChartPair,
} from './music-service-shell.js?v=20261004.2';

const rankingSections = [
  {
    chartSectionId: 'kugouJapanChartSection', group: 'japan',
    historySectionId: 'kugouJapanHistorySection',
    chartTitle: '酷狗音乐 日本榜 グループ別最高順位推移',
    historyTitle: '酷狗音乐 日本榜 ランクイン履歴',
    chartId: 'kugouJapanRankChart',
    legendId: 'kugouJapanRankLegend',
    historyBodyId: 'kugouJapanHistoryBody',
    filterAriaLabel: '酷狗音乐 日本榜 表示グループ',
    dateLabel: '年月日',
  },
  {
    chartSectionId: 'kugouAcgChartSection', group: 'acg',
    historySectionId: 'kugouAcgHistorySection',
    chartTitle: '酷狗音乐 ACG新歌榜 グループ別最高順位推移',
    historyTitle: '酷狗音乐 ACG新歌榜 ランクイン履歴',
    chartId: 'kugouAcgRankChart',
    legendId: 'kugouAcgRankLegend',
    historyBodyId: 'kugouAcgHistoryBody',
    filterAriaLabel: '酷狗音乐 ACG新歌榜 表示グループ',
  },
].flatMap((config) => musicServiceRegionalChartPair({
  ...config,
  filterAttribute: 'kugou-artist-filter',
}));

mountMusicServiceView({
  viewId: 'kugouMusicView',
  className: 'kugou-music-view',
  groupLabels: { japan: '日本榜', acg: 'ACG新曲' },
  noticeId: 'kugouMusicNotice',
  meta: {
    valueId: 'kugouMusicUpdatedAt',
    cadenceId: 'kugouMusicCadence',
  },
  sections: rankingSections,
});
