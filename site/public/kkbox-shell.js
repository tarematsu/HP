import {
  mountMusicServiceView,
  musicServiceFilterTabs,
  musicServiceSection,
  musicServiceSakamichiFilter,
  musicServiceRankingHistoryTable,
  musicServiceRankChart,
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

const artistFilter = musicServiceSakamichiFilter({
  dataAttribute: 'kkbox-artist-filter',
  ariaLabel: 'KKBOX 日語チャート 表示グループ',
});
const historyTable = musicServiceRankingHistoryTable('kkboxJapaneseHistoryBody');

mountMusicServiceView({
  viewId: 'kkboxView',
  className: 'kkbox-view',
  noticeId: 'kkboxNotice',
  meta: {
    valueId: 'kkboxUpdatedAt',
    cadenceId: 'kkboxCadence',
  },
  sections: [
    musicServiceSection({
      id: 'kkboxJapaneseChartSection',
      title: 'KKBOX 日語チャート グループ別最高順位推移',
      bodyHtml: `${seriesFilters}${musicServiceRankChart({ legendId: 'kkboxJapaneseRankLegend', chartId: 'kkboxJapaneseRankChart' })}`,
    }),
    musicServiceSection({
      id: 'kkboxJapaneseHistorySection', group: 'list',
      title: 'KKBOX 日語チャート ランクイン履歴',
      trailingHtml: artistFilter,
      bodyHtml: historyTable,
    }),
  ],
});