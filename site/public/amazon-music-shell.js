import {
  dashboardChartCard,
  dashboardChartHost,
  dashboardDataCard,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const tracksTable = dashboardTable({
  className: 'amazon-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="amazon-rank-col"><col class="amazon-rank-col"><col></colgroup>',
  headers: ['Amazon Music総合順位', '前日比', '曲名'],
  bodyId: 'amazonMusicTbody',
});

mountDashboardShell({
  tab: {
    view: 'amazon-music',
    label: 'Amazon Music',
    anchorSelector: '[data-view="spotify"]',
    position: 'afterend',
  },
  view: {
    id: 'amazonMusicView',
    className: 'amazon-music-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${dashboardNotice({ id: 'amazonMusicNotice' })}
      ${dashboardChartCard({
        title: 'Amazon Music総合順位推移',
        titleId: 'amazonAllRankTitle',
        kicker: 'AMAZON MUSIC',
        className: 'amazon-rank-panel',
        chartHtml: dashboardChartHost({
          id: 'amazonAllRankChart',
          className: 'amazon-rank-chart chart-fit',
          ariaLabel: '櫻坂46楽曲のAmazon Music総合順位推移',
          role: '',
        }),
      })}
      ${dashboardDataCard({
        title: '櫻坂46の全楽曲順位',
        kicker: 'AMAZON MUSIC TRACKS',
        className: 'amazon-data-panel',
        trailingHtml: '<span class="subtle">集計日 <time id="amazonSnapshotDate">-</time></span>',
        bodyHtml: tracksTable,
      })}`,
  },
});
