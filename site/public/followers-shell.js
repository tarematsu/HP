function ensureStylesheet() {
  if (document.querySelector('link[data-followers-tab-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/followers.css?v=20260930.1';
  link.dataset.followersTabStyles = '1';
  document.head.append(link);
}

function mountTab() {
  const tabs = document.getElementById('modeTabs');
  if (!tabs || tabs.querySelector('[data-view="followers"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = 'followers';
  button.textContent = 'フォロワー';
  const firstWeek = tabs.querySelector('[data-view="first-week"]');
  if (firstWeek) firstWeek.insertAdjacentElement('afterend', button);
  else tabs.append(button);
}

function mountView() {
  const main = document.getElementById('content');
  if (!main || document.getElementById('followersView')) return;
  const historyView = document.getElementById('historyView');
  const section = document.createElement('section');
  section.id = 'followersView';
  section.className = 'dashboard-view followers-view';
  section.hidden = true;
  section.innerHTML = `
    <p id="followersNotice" class="notice" role="status" hidden></p>

    <section class="card followers-chart-panel" aria-labelledby="followersChartTitle">
      <div class="section-head followers-head">
        <div><p class="kicker">STATIONHEAD FOLLOWERS</p><h2 id="followersChartTitle">フォロワー数推移</h2></div>
        <span id="followersLatestDate" class="pill">-</span>
      </div>
      <div id="followersLegend" class="followers-legend" aria-label="アカウント別の最新フォロワー数"></div>
      <div id="followersChart" class="followers-chart" role="img" aria-label="4アカウントのフォロワー数推移"></div>
    </section>

    <section class="card data-panel followers-data-panel">
      <div class="section-head"><div><p class="kicker">LATEST</p><h2>最新フォロワー比較</h2></div></div>
      <div class="table-wrap table-fit-mobile">
        <table class="followers-table">
          <colgroup><col class="followers-account-col"><col><col><col></colgroup>
          <thead><tr><th>アカウント名</th><th>現在</th><th>前日比</th><th>1週間比</th></tr></thead>
          <tbody id="followersTbody"></tbody>
        </table>
      </div>
    </section>`;
  if (historyView) historyView.insertAdjacentElement('afterend', section);
  else main.append(section);
}

ensureStylesheet();
mountTab();
mountView();