function ensureStylesheet() {
  if (document.querySelector('link[data-first-week-comparison-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/first-week-comparison.css?v=20260927.1';
  link.dataset.firstWeekComparisonStyles = '1';
  document.head.append(link);
}

function mountTab() {
  const tabs = document.getElementById('modeTabs');
  const daily = tabs?.querySelector('[data-mode="daily"]');
  if (!tabs || !daily || tabs.querySelector('[data-view="first-week"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = 'first-week';
  button.textContent = '初週比較';
  daily.insertAdjacentElement('afterend', button);
}

function mountView() {
  const main = document.getElementById('content');
  if (!main || document.getElementById('firstWeekView')) return;

  const section = document.createElement('section');
  section.id = 'firstWeekView';
  section.className = 'dashboard-view first-week-view';
  section.hidden = true;
  section.innerHTML = `
    <div class="first-week-toolbar">
      <div class="first-week-metric-toggle" role="group" aria-label="比較指標">
        <button type="button" data-first-week-metric="listener" class="active">同接</button>
        <button type="button" data-first-week-metric="streams">再生数増加</button>
      </div>
    </div>

    <p id="firstWeekNotice" class="notice" role="status" hidden></p>

    <section class="card chart-panel first-week-chart-panel">
      <div class="section-head chart-head">
        <div><p class="kicker">FIRST WEEK COMPARISON</p><h2 id="firstWeekChartTitle">先行配信後の同接推移</h2></div>
        <div id="firstWeekLegend" class="chart-legend first-week-legend" aria-label="楽曲凡例"></div>
      </div>
      <canvas id="firstWeekChart" width="960" height="360" aria-label="表題曲の配信初週比較グラフ"></canvas>
      <div class="chart-axis"><span>配信 0時間</span><span>7日</span></div>
      <div id="firstWeekChartDetail" class="chart-detail">グラフをタッチすると、同じ経過時点の数値を比較できます。</div>
      <p id="firstWeekChartFoot" class="chart-foot">各楽曲の先行配信日（JST）0:00を0時間として168時間を比較します。</p>
    </section>

    <section class="card data-panel first-week-data-panel">
      <div class="section-head"><div><p class="kicker">RELEASES</p><h2>比較対象</h2></div></div>
      <div class="table-wrap">
        <table class="first-week-table">
          <thead><tr><th>シングル</th><th>曲名</th><th>先行配信日</th><th>データ</th><th>出典</th></tr></thead>
          <tbody id="firstWeekTbody"></tbody>
        </table>
      </div>
    </section>`;
  main.append(section);
}

ensureStylesheet();
mountTab();
mountView();