import {
  mountMusicServiceView,
  musicServiceFilterTabs,
  musicServiceRegionalChartPair,
} from './music-service-shell.js?v=20261004.2';

const seriesFilters = [
  musicServiceFilterTabs([
    { value: 'tw', label: '台湾', active: true },
    { value: 'hk', label: '香港' },
  ], { dataAttribute: 'kkbox-territory-filter', ariaLabel: 'KKBOX 地域' }),
  musicServiceFilterTabs([
    { value: 'weekly', label: '週次', active: true },
    { value: 'daily', label: '日次' },
  ], { dataAttribute: 'kkbox-period-filter', ariaLabel: 'KKBOX 更新周期' }),
  musicServiceFilterTabs([
    { value: 'newrelease', label: '新曲', active: true },
    { value: 'song', label: '楽曲' },
  ], { dataAttribute: 'kkbox-chart-filter', ariaLabel: 'KKBOX チャート種別' }),
].join('');

mountMusicServiceView({
  viewId: 'kkboxView',
  className: 'kkbox-view',
  noticeId: 'kkboxNotice',
  meta: {
    valueId: 'kkboxUpdatedAt',
    cadenceId: 'kkboxCadence',
  },
  sections: musicServiceRegionalChartPair({
    chartSectionId: 'kkboxJapaneseChartSection',
    historySectionId: 'kkboxJapaneseHistorySection',
    chartTitle: 'KKBOX 日語チャート グループ別最高順位推移',
    historyTitle: 'KKBOX 日語チャート ランクイン履歴',
    chartId: 'kkboxJapaneseRankChart',
    legendId: 'kkboxJapaneseRankLegend',
    historyBodyId: 'kkboxJapaneseHistoryBody',
    filterAttribute: 'kkbox-artist-filter',
    filterAriaLabel: 'KKBOX 日語チャート 表示グループ',
    leadingChartHtml: seriesFilters,
  }),
});
