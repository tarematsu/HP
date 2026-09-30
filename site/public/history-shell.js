import {
  dashboardChartCard,
  dashboardControls,
  dashboardDataCard,
  dashboardSummary,
  dashboardSummaryItem,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const controls = dashboardControls({
  id: 'controls',
  bodyHtml: '<div id="standardControls" class="control-group standard-controls"><div id="rangePresets" class="range-presets" aria-label="期間プリセット"><button type="button" data-days="30">1ヶ月</button><button type="button" data-days="180">半年</button><button type="button" data-days="365">1年</button><button type="button" data-days="all" class="active">全期間</button></div><input id="from" type="hidden" value="2024-05-01"><input id="to" type="hidden"></div><div id="rankingControls" class="control-group ranking-controls" hidden><label><span>対象</span><select id="rankingScope"><option value="featured">坂道</option><option value="all">全ホスト</option></select></label><label><span>検索</span><input id="rankingHost" type="search" maxlength="100" placeholder="ホスト名"></label></div><button id="load" type="button" hidden aria-hidden="true" tabindex="-1"></button>',
});

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '<span id="periodLabel">期間数</span>', valueId: 'periods' }),
  dashboardSummaryItem({ label: '<span id="maxLabel">平均同接</span>', valueId: 'maxListener' }),
  dashboardSummaryItem({ label: '<span id="streamLabel">再生数増加</span>', valueId: 'streamGrowth' }),
  dashboardSummaryItem({ label: '<span id="memberLabel">メンバー増加数</span>', valueId: 'memberGrowth' }),
], { id: 'summaryCards', ariaLabel: '集計概要' });

const chart = dashboardChartCard({
  id: 'chartPanel',
  title: '主要指標の推移',
  titleId: 'chartTitle',
  kicker: 'TREND',
  trailingHtml: '<div id="chartLegend" class="chart-legend" aria-label="グラフ凡例"></div>',
  chartHtml: '<canvas id="chart" width="960" height="360" aria-label="履歴推移グラフ"></canvas><div class="chart-axis"><span id="chartStartDate">-</span><span id="chartEndDate">-</span></div>',
  detailHtml: '<div id="chartDetail" class="chart-detail" data-history-chart-detail></div>',
  footerHtml: '<p id="chartFoot" class="chart-foot"></p>',
});

const data = dashboardDataCard({
  title: '集計一覧',
  titleId: 'tableTitle',
  kicker: 'DATA',
  trailingHtml: '<button id="csv" class="button" type="button">CSV</button>',
  bodyHtml: '<div class="table-wrap"><table><thead id="thead"></thead><tbody id="tbody"></tbody></table></div><button id="more" class="button more-button" type="button" hidden>さらに表示</button>',
});

const weekly = dashboardDataCard({
  id: 'rankingWeeklyPanel',
  title: 'Buddies週間実績',
  kicker: 'BUDDIES WEEKLY METRICS',
  bodyHtml: '<div class="table-wrap"><table class="weekly-ranking-table"><thead id="rankingWeeklyThead"></thead><tbody id="rankingWeeklyTbody"></tbody></table></div>',
});

mountDashboardShell({
  view: {
    id: 'historyView',
    className: 'history-view',
    anchorId: 'currentView',
    position: 'afterend',
    html: `<div id="guide" hidden aria-hidden="true"><p class="kicker"></p><h2 id="guideTitle"></h2><p id="guideText"></p></div>${controls}<p id="notice" class="notice" role="status"></p>${summary}${chart}${data}${weekly}`,
  },
});

document.getElementById('rankingWeeklyPanel')?.setAttribute('hidden', '');
