import {
  mountMusicServiceView,
  musicServiceFilterTabs,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';

function filterTabs(items, options) {
  return musicServiceFilterTabs(items, options);
}

const seriesFilters = [
  filterTabs([
    { value: 'tw', label: '台湾', active: true },
    { value: 'hk', label: '香港' },
  ], { dataAttribute: 'kkbox-territory-filter', ariaLabel: 'KKBOX 地域' }),
  filterTabs([
    { value: 'weekly', label: '週次', active: true },
    { value: 'daily', label: '日次' },
  ], { dataAttribute: 'kkbox-period-filter', ariaLabel: 'KKBOX 更新周期' }),
  filterTabs([
    { value: 'newrelease', label: '新曲', active: true },
    { value: 'song', label: '楽曲' },
  ], { dataAttribute: 'kkbox-chart-filter', ariaLabel: 'KKBOX チャート種別' }),
].join('');

const artistFilter = filterTabs([
  { value: 'all', label: 'すべて', active: true },
  { value: 'sakurazaka46', label: '櫻坂' },
  { value: 'nogizaka46', label: '乃木坂' },
  { value: 'hinatazaka46', label: '日向坂' },
], {
  dataAttribute: 'kkbox-artist-filter',
  ariaLabel: 'KKBOX 日語チャート 表示グループ',
});

const historyTable = musicServiceTable({
  className: 'music-service-history-table',
  wrapClassName: 'music-service-table-wrap',
  headers: ['更新日', 'グループ', '順位', '曲名'],
  bodyId: 'kkboxJapaneseHistoryBody',
});

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
      bodyHtml: `${seriesFilters}<div id="kkboxJapaneseRankLegend" class="music-service-rank-legend" aria-label="グループ凡例"></div><div id="kkboxJapaneseRankChart" class="music-service-rank-chart"></div>`,
    }),
    musicServiceSection({
      id: 'kkboxJapaneseHistorySection',
      title: 'KKBOX 日語チャート ランクイン履歴',
      trailingHtml: artistFilter,
      bodyHtml: historyTable,
    }),
  ],
});