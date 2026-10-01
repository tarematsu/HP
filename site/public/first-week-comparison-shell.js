import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardLegend,
  dashboardNotice,
  dashboardTable,
} from './dashboard-ui-common.js?v=20261001.1';

const comparisonTable = dashboardTable({
  className: 'first-week-table',
  headers: ['シングル', '曲名', 'ストリーミング配信日', 'データ', '出典'],
  bodyId: 'firstWeekTbody',
});

function broadcastsTab() {
  return document.querySelector('#modeTabs [data-mode="broadcasts"]');
}

function mountView() {
  const historyView = document.getElementById('historyView');
  if (!historyView) return null;
  const existing = document.getElementById('firstWeekView');
  if (existing) return existing;

  const section = document.createElement('section');
  section.id = 'firstWeekView';
  section.className = 'first-week-view';
  section.hidden = true;
  section.innerHTML = `
    ${dashboardNotice({ id: 'firstWeekNotice' })}
    ${dashboardChartCard({
      title: 'ストリーミング配信後の同接推移',
      titleId: 'firstWeekChartTitle',
      kicker: 'FIRST WEEK COMPARISON',
      trailingHtml: dashboardLegend({
        id: 'firstWeekLegend',
        className: 'chart-legend first-week-legend',
        ariaLabel: '楽曲凡例',
      }),
      className: 'first-week-chart-panel',
      chartHtml: '<canvas id="firstWeekChart" width="960" height="360" aria-label="表題曲の配信初週比較グラフ"></canvas><div class="chart-axis"><span>配信 0時間</span><span>7日</span></div>',
      detailHtml: '<div id="firstWeekChartDetail" class="chart-detail"></div>',
      footerHtml: '<p id="firstWeekChartFoot" class="chart-foot">各楽曲のストリーミング配信日（JST）0:00を0時間として168時間を比較します。</p>',
    })}
    ${dashboardDataCard({
      title: '比較対象',
      kicker: 'RELEASES',
      className: 'first-week-data-panel',
      bodyHtml: comparisonTable,
    })}`;

  const unofficialPanel = document.getElementById('unofficialListeningPanel');
  if (unofficialPanel?.parentElement === historyView) unofficialPanel.before(section);
  else historyView.append(section);
  return section;
}

const view = mountView();
const historyView = document.getElementById('historyView');

function syncVisibility() {
  if (!view) return;
  const tab = broadcastsTab();
  const shouldShow = Boolean(tab?.classList.contains('active') && historyView && !historyView.hidden);
  if (view.hidden === shouldShow) view.hidden = !shouldShow;
}

const tab = broadcastsTab();
if (tab) {
  new MutationObserver(syncVisibility).observe(tab, {
    attributes: true,
    attributeFilter: ['class', 'aria-current'],
  });
}
if (historyView) {
  new MutationObserver(syncVisibility).observe(historyView, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
}
if (view) {
  new MutationObserver(syncVisibility).observe(view, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
}

if (location.hash === '#first-week') {
  history.replaceState(null, '', `${location.pathname}${location.search}#broadcasts`);
  queueMicrotask(() => broadcastsTab()?.click());
}

syncVisibility();
