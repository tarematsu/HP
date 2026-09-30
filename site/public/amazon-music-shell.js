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
  colgroupHtml: '<colgroup><col class="amazon-rank-col"><col class="amazon-rank-col"><col class="amazon-artist-col"><col></colgroup>',
  headers: ['Amazon Music総合順位', '前日比', 'アーティスト', '曲名'],
  bodyId: 'amazonMusicTbody',
});

const modeButtons = `
  <div class="mode-tabs amazon-mode-switch" role="group" aria-label="Amazon Music表示切替">
    <button type="button" class="is-active" data-amazon-mode="all" aria-pressed="true">全楽曲順位</button>
    <button type="button" data-amazon-mode="titles" aria-pressed="false">表題曲比較</button>
    <button type="button" data-amazon-mode="nogizaka" aria-pressed="false">乃木坂46</button>
    <button type="button" data-amazon-mode="sakurazaka" aria-pressed="false">櫻坂46</button>
    <button type="button" data-amazon-mode="hinatazaka" aria-pressed="false">日向坂46</button>
  </div>`;

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
      <div class="amazon-summary subtle">集計日 <time id="amazonSnapshotDate">-</time></div>
      ${dashboardNotice({ id: 'amazonMusicNotice' })}
      ${modeButtons}
      ${dashboardChartCard({
        title: 'Amazon Music総合順位推移',
        titleId: 'amazonAllRankTitle',
        kicker: 'AMAZON MUSIC',
        className: 'amazon-rank-panel',
        chartHtml: dashboardChartHost({
          id: 'amazonAllRankChart',
          className: 'amazon-rank-chart chart-fit',
          ariaLabel: '坂道3グループ楽曲のAmazon Music総合順位推移',
          role: '',
        }),
      })}
      ${dashboardDataCard({
        title: '全楽曲順位',
        titleId: 'amazonTracksTitle',
        kicker: 'AMAZON MUSIC TRACKS',
        className: 'amazon-data-panel',
        bodyHtml: tracksTable,
      })}`,
  },
});
