function ensureStylesheet() {
  if (document.querySelector('link[data-hinata-tab-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/hinata.css?v=20260930.3';
  link.dataset.hinataTabStyles = '1';
  document.head.append(link);
}

function mountTab() {
  const tabs = document.getElementById('modeTabs');
  if (!tabs || tabs.querySelector('[data-view="hinata"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = 'hinata';
  button.textContent = '日向坂';
  const amazonMusic = tabs.querySelector('[data-view="amazon-music"]');
  const spotify = tabs.querySelector('[data-view="spotify"]');
  const anchor = amazonMusic || spotify;
  if (anchor) anchor.insertAdjacentElement('afterend', button);
  else tabs.append(button);
}

function mountView() {
  const main = document.getElementById('content');
  if (!main || document.getElementById('hinataView')) return;
  const historyView = document.getElementById('historyView');
  const section = document.createElement('section');
  section.id = 'hinataView';
  section.className = 'dashboard-view hinata-view';
  section.hidden = true;
  section.innerHTML = `
    <p id="hinataNotice" class="notice" role="status" hidden></p>

    <section class="metrics hinata-metrics" aria-label="日向坂 Stationhead 最新値">
      <article class="metric hinata-metric"><span>オンライン</span><div class="metric-value"><strong id="hinataOnline">—</strong></div></article>
      <article class="metric hinata-metric"><span>総再生数</span><div class="metric-value"><strong id="hinataStreams">—</strong></div></article>
      <article class="metric hinata-metric"><span>総メンバー数</span><div class="metric-value"><strong id="hinataMembers">—</strong></div></article>
    </section>

    <section class="card chart-card hinata-chart-panel" aria-labelledby="hinataChartTitle">
      <div class="section-head chart-head hinata-section-head">
        <div><p class="kicker">OHISAMA / 24H</p><h2 id="hinataChartTitle">オンライン・再生数</h2></div>
        <span id="hinataUpdated" class="pill">—</span>
      </div>
      <div class="legend hinata-legend" aria-label="グラフ凡例">
        <span><i class="hinata-line-key"></i>オンライン</span>
        <span><i class="hinata-bar-key"></i>再生数増加</span>
      </div>
      <div id="hinataChart" class="hinata-chart chart-fit" role="img" aria-label="過去24時間のオンライン数と5分ごとの再生数増加"></div>
      <p id="hinataChartDetail" class="chart-detail subtle hinata-chart-detail">グラフをタッチすると数値を確認できます。</p>
    </section>

    <section class="card data-panel hinata-daily-panel" aria-labelledby="hinataDailyTitle">
      <div class="section-head"><div><p class="kicker">DAILY</p><h2 id="hinataDailyTitle">日次データ</h2></div></div>
      <div class="table-wrap table-fit-mobile">
        <table class="hinata-daily-table">
          <thead><tr><th>日付</th><th>平均同接</th><th>最小同接</th><th>最大同接</th><th>再生数（開始）</th><th>再生数（終了）</th><th>再生数増加</th><th>メンバー数（開始）</th><th>メンバー数（終了）</th><th>メンバー増加</th></tr></thead>
          <tbody id="hinataDailyTbody"></tbody>
        </table>
      </div>
    </section>`;
  if (historyView) historyView.insertAdjacentElement('afterend', section);
  else main.append(section);
}

ensureStylesheet();
mountTab();
mountView();
