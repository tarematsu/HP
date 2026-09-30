import {
  dashboardChartCard,
  dashboardDataCard,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

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
      <p id="amazonMusicNotice" class="notice" role="status" hidden></p>
      ${dashboardChartCard({
        title: 'Amazon Music総合順位推移',
        titleId: 'amazonAllRankTitle',
        kicker: 'AMAZON MUSIC',
        className: 'amazon-rank-panel',
        chartHtml: '<div id="amazonAllRankChart" class="amazon-rank-chart chart-fit shared-svg-chart" aria-label="櫻坂46楽曲のAmazon Music総合順位推移"></div>',
      })}
      ${dashboardDataCard({
        title: '櫻坂46の全楽曲順位',
        kicker: 'AMAZON MUSIC TRACKS',
        className: 'amazon-data-panel',
        trailingHtml: '<span class="subtle">集計日 <time id="amazonSnapshotDate">-</time></span>',
        bodyHtml: '<div class="table-wrap table-fit-mobile"><table class="amazon-table shared-numeric-table"><colgroup><col class="amazon-rank-col"><col class="amazon-rank-col"><col></colgroup><thead><tr><th>Amazon Music総合順位</th><th>前日比</th><th>曲名</th></tr></thead><tbody id="amazonMusicTbody"></tbody></table></div>',
      })}`,
  },
});
