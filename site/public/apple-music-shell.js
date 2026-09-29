function ensureStylesheet() {
  if (document.querySelector('link[data-apple-music-tab-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/apple-music.css?v=20260930.1';
  link.dataset.appleMusicTabStyles = '1';
  document.head.append(link);
}

function mountTab() {
  const tabs = document.getElementById('modeTabs');
  if (!tabs || tabs.querySelector('[data-view="apple-music"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = 'apple-music';
  button.textContent = 'Apple Music';
  const amazon = tabs.querySelector('[data-view="amazon-music"]');
  const spotify = tabs.querySelector('[data-view="spotify"]');
  if (amazon) amazon.insertAdjacentElement('afterend', button);
  else if (spotify) spotify.insertAdjacentElement('afterend', button);
  else tabs.append(button);
}

function mountView() {
  const main = document.getElementById('content');
  if (!main || document.getElementById('appleMusicView')) return;
  const likesView = document.getElementById('likesView');
  const section = document.createElement('section');
  section.id = 'appleMusicView';
  section.className = 'dashboard-view apple-music-view';
  section.hidden = true;
  section.innerHTML = `
    <p id="appleMusicNotice" class="notice" role="status" hidden></p>

    <section class="summary-cards apple-summary" aria-label="櫻坂46 Apple Music 地域別順位概要">
      <article><span>取得地域</span><strong id="appleRegionCount">-</strong></article>
      <article><span>取得日</span><strong id="appleSnapshotDate">-</strong></article>
    </section>

    <section class="card apple-rank-panel" aria-labelledby="appleRegionRankTitle">
      <div class="section-head">
        <div><p class="kicker">APPLE MUSIC</p><h2 id="appleRegionRankTitle">櫻坂46 人気曲順位</h2></div>
      </div>
      <div id="appleRegionTabs" class="apple-region-tabs" aria-label="地域選択"></div>
      <div id="appleRankChart" class="apple-rank-chart chart-fit" aria-label="選択地域のApple Music人気曲順位推移"></div>
      <div class="table-wrap table-fit-mobile">
        <table class="apple-table">
          <colgroup><col class="apple-rank-col"><col><col class="apple-change-col"></colgroup>
          <thead><tr><th>順位</th><th>曲名</th><th>前日比</th></tr></thead>
          <tbody id="appleMusicTbody"></tbody>
        </table>
      </div>
    </section>

    <section class="card data-panel apple-data-panel" aria-labelledby="appleRegionCompareTitle">
      <div class="section-head">
        <div><p class="kicker">REGION COMPARISON</p><h2 id="appleRegionCompareTitle">地域別 人気順位比較</h2></div>
      </div>
      <div class="table-wrap apple-region-table-wrap">
        <table id="appleRegionCompareTable" class="apple-table apple-region-table"></table>
      </div>
    </section>`;
  if (likesView) likesView.insertAdjacentElement('beforebegin', section);
  else main.append(section);
}

ensureStylesheet();
mountTab();
mountView();
