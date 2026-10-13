import {
  mountMusicServiceView,
  musicServiceFilterTabs,
  musicServiceRegionalChartPair,
} from './music-service-shell.js?v=20261004.2';

const seriesFilters = musicServiceFilterTabs([
  { value: 'tw:newrelease', label: '台湾新曲', active: true },
  { value: 'hk:newrelease', label: '香港新曲' },
  { value: 'tw:song', label: '台湾楽曲' },
  { value: 'hk:song', label: '香港楽曲' },
], { dataAttribute: 'kkbox-series-filter', className: 'music-service-view-tabs', ariaLabel: 'KKBOX チャート分類' });
const periodTabs = musicServiceFilterTabs([
  { value: 'daily', label: '日次' },
  { value: 'weekly', label: '週次', active: true },
], { dataAttribute: 'kkbox-period-filter', className: 'history-granularity-toggle', ariaLabel: 'KKBOX 集計単位' });

mountMusicServiceView({
  viewId: 'kkboxView',
  className: 'kkbox-view',
  noticeId: 'kkboxNotice',
  meta: {
    valueId: 'kkboxUpdatedAt',
    cadenceId: 'kkboxCadence',
  },
  beforeSectionsHtml: seriesFilters + periodTabs,
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
    
  }),
});
