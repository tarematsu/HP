import {
  dashboardChartCard,
  dashboardControls,
  dashboardDataCard,
  dashboardLegend,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const controls = dashboardControls({
  id: 'controls',
  bodyHtml: '<div id="standardControls" class="control-group standard-controls"><div id="rangePresets" class="range-presets" aria-label="期間プリセット"><button type="button" data-days="30">1ヶ月</button><button type="button" data-days="180">半年</button><button type="button" data-days="365">1年</button><button type="button" data-days="all" class="active">全期間</button></div><input id="from" type="hidden" value="2024-05-01"><input id="to" type="hidden"></div><div id="rankingControls" hidden style="display:none"><input id="rankingScope" type="hidden" value="featured"><input id="rankingHost" type="hidden" value=""></div><button id="load" type="button" hidden aria-hidden="true" tabindex="-1"></button>',
});

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '<span id="periodLabel"></span>', valueId: 'periods' }),
  dashboardSummaryItem({ label: '<span id="maxLabel"></span>', valueId: 'maxListener' }),
  dashboardSummaryItem({ label: '<span id="streamLabel"></span>', valueId: 'streamGrowth' }),
  dashboardSummaryItem({ label: '<span id="memberLabel"></span>', valueId: 'memberGrowth' }),
], { id: 'summaryCards', ariaLabel: '集計概要' });

const chart = dashboardChartCard({
  id: 'chartPanel',
  title: '',
  titleId: 'chartTitle',
  kicker: 'TREND',
  trailingHtml: dashboardLegend({ id: 'chartLegend', className: 'chart-legend' }),
  chartHtml: '<canvas id="chart" width="960" height="360" aria-label="履歴推移グラフ"></canvas><div class="chart-axis"><span id="chartStartDate">-</span><span id="chartEndDate">-</span></div>',
  detailHtml: '<div id="chartDetail" class="chart-detail" data-history-chart-detail></div>',
  footerHtml: '<p id="chartFoot" class="chart-foot"></p>',
});

const dataTable = dashboardTable({
  headId: 'thead',
  bodyId: 'tbody',
  numeric: false,
});

const data = dashboardDataCard({
  title: '',
  titleId: 'tableTitle',
  kicker: 'DATA',
  trailingHtml: '<button id="csv" class="button" type="button">CSV</button>',
  bodyHtml: `${dataTable}<button id="more" class="button more-button" type="button" hidden>さらに表示</button>`,
});

const weekly = dashboardDataCard({
  id: 'rankingWeeklyPanel',
  title: 'Buddies週間実績',
  kicker: 'BUDDIES WEEKLY METRICS',
  bodyHtml: dashboardTable({
    className: 'weekly-ranking-table',
    headId: 'rankingWeeklyThead',
    bodyId: 'rankingWeeklyTbody',
    numeric: false,
  }),
  hidden: true,
});

mountDashboardShell({
  view: {
    id: 'historyView',
    className: 'history-view',
    anchorId: 'currentView',
    position: 'afterend',
    html: `<div id="guide" hidden aria-hidden="true"><p class="kicker"></p><h2 id="guideTitle"></h2><p id="guideText"></p></div>${controls}${dashboardNotice({ id: 'notice', hidden: false })}${summary}${chart}${data}${weekly}`,
  },
});
