import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardLegend,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import { stationheadChannelTabs } from './stationhead-channel-tabs.js?v=20261003.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '期間数', valueId: 'nogizakaPartyPeriods' }),
  dashboardSummaryItem({ label: '平均同接', valueId: 'nogizakaPartyAverage' }),
  dashboardSummaryItem({ label: '最大同接', valueId: 'nogizakaPartyMaximum' }),
  dashboardSummaryItem({ label: '所要時間', valueId: 'nogizakaPartyDuration' }),
], { ariaLabel: '乃木坂46公式リスパ集計概要' });

const partyTable = dashboardTable({
  className: 'official-party-table',
  headId: 'nogizakaPartyThead',
  bodyId: 'nogizakaPartyTbody',
});

const subtabs = stationheadChannelTabs({
  dataAttribute: 'nogizaka-section',
  ariaLabel: 'Nogizaka表示切替',
  active: 'broadcasts',
  enabled: ['broadcasts'],
  unavailableTitle: 'Nogizakaでは未提供',
});

const listeningPartyPanel = `<div class="stationhead-channel-panel" data-nogizaka-panel="broadcasts">${summary}${dashboardChartCard({
  title: '乃木坂 公式リスパ 同接推移',
  kicker: 'TREND',
  trailingHtml: dashboardLegend({ id: 'nogizakaPartyLegend', className: 'chart-legend' }),
  chartHtml: '<div class="chart-fit"><canvas id="nogizakaPartyChart" width="960" height="360" style="height:20em" aria-label="乃木坂46公式リスパの同接推移"></canvas></div><div class="chart-axis"><span>開始 0分</span><span id="nogizakaPartyChartEnd">-</span></div>',
  footerHtml: '<p class="chart-foot">横軸は放送開始からの経過時間です。開催中は自動更新します。</p>',
})}${dashboardDataCard({
  title: '公式リスパ一覧',
  kicker: 'DATA',
  trailingHtml: '<button id="nogizakaPartyCsv" class="button" type="button">CSV</button>',
  bodyHtml: partyTable,
})}</div>`;

mountDashboardShell({
  tab: {
    view: 'nogizaka',
    label: 'Nogizaka',
    anchorSelectors: ['[data-view="hinata"]', '[data-mode="broadcasts"]'],
    position: 'beforebegin',
  },
  view: {
    id: 'nogizakaListeningPartyView',
    className: 'history-view nogizaka-listening-party-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `${dashboardNotice({ id: 'nogizakaListeningPartyNotice' })}${subtabs}${listeningPartyPanel}`,
  },
});
