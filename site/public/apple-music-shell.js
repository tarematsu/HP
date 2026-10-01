import {
  dashboardChartCard,
  dashboardChartHost,
  dashboardDataCard,
  dashboardLegend,
  dashboardModeTabs,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import {
  musicServiceMeta,
  musicServiceSection,
} from './music-service-shell.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '取得地域数', valueId: 'appleRegionCount' }),
  dashboardSummaryItem({ label: '掲載プレイリスト', valueId: 'applePlaylistCount' }),
  dashboardSummaryItem({ label: '掲載楽曲数', valueId: 'applePlaylistTrackCount' }),
], { className: 'music-service-summary apple-summary', ariaLabel: 'Apple Music概要' });

const artistTabs = dashboardModeTabs([
  { value: 'sakurazaka46', label: '櫻坂46', active: true },
  { value: 'nogizaka46', label: '乃木坂46' },
  { value: 'hinatazaka46', label: '日向坂46' },
], { dataAttribute: 'apple-artist', ariaLabel: 'Apple Musicアーティスト切替' });

const regionTable = dashboardTable({
  id: 'appleRegionCompareTable',
  className: 'apple-table apple-region-table music-service-track-table',
  wrapClassName: 'apple-region-table-wrap',
});

const rankPanel = dashboardChartCard({
  title: '櫻坂46 日本の人気曲順位推移',
  titleId: 'appleJapanRankTitle',
  kicker: 'APPLE MUSIC · JAPAN',
  trailingHtml: artistTabs,
  className: 'apple-rank-panel music-service-panel',
  chartHtml: dashboardChartHost({
    id: 'appleRankChart',
    className: 'apple-rank-chart chart-fit',
    ariaLabel: 'Apple Music日本の人気曲順位推移',
    role: '',
  }),
  legendHtml: dashboardLegend({
    id: 'appleRankLegend',
    className: 'apple-rank-legend',
    ariaLabel: '日本の現在順位',
  }),
});

const tracksPanel = dashboardDataCard({
  title: '櫻坂46 地域別人気順位一覧',
  titleId: 'appleRegionCompareTitle',
  kicker: 'TRACKS',
  className: 'apple-data-panel music-service-panel',
  bodyHtml: regionTable,
});

mountDashboardShell({
  tab: {
    view: 'apple-music',
    label: 'Apple Music',
    anchorSelector: '[data-view="spotify"]',
    position: 'beforebegin',
  },
  view: {
    id: 'appleMusicView',
    className: 'apple-music-view music-service-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ valueId: 'appleSnapshotDate' })}
      ${dashboardNotice({ id: 'appleMusicNotice' })}
      ${summary}
      ${musicServiceSection({ id: 'appleTrendSection', kicker: 'TRENDS', title: '推移', bodyHtml: rankPanel })}
      ${musicServiceSection({ id: 'appleTrackSection', kicker: 'TRACKS', title: '楽曲', bodyHtml: tracksPanel })}
      ${musicServiceSection({
        id: 'applePlaylistSection',
        kicker: 'PLAYLISTS',
        title: 'プレイリスト',
        bodyHtml: '<div id="applePlaylistMount"></div>',
      })}`,
  },
});