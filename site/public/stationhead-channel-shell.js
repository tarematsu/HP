import { dashboardModeTabs, mountDashboardView } from './dashboard-ui-common.js?v=20261004.1';
import { STATIONHEAD_CHANNEL_TABS } from './stationhead-channel-model.js?v=20261004.1';

function role(name) { return `data-role="${name}"`; }
function metric(label, name, featured = false) { return `<article class="metric${featured ? ' featured' : ''}"><span>${label}</span><div class="metric-value"><strong ${role(name)}>—</strong></div></article>`; }
function summaryItem(label, name) { return `<article><span>${label}</span><strong ${role(name)}>—</strong></article>`; }

function playbackCards() {
  return `<section class="primary-grid">
    <article class="card now-card">
      <div class="section-head now-head"><div><p class="kicker">NOW PLAYING</p><h2>再生中の曲</h2></div><div class="host" ${role('host')}></div></div>
      <a class="now-playing" ${role('station-link')} href="https://stationhead.com/" target="_blank" rel="noopener noreferrer"><span class="track-visual" aria-hidden="true"><span class="track-fallback">♪</span><img class="track-image" ${role('track-image')} alt="" width="104" height="104" decoding="async" hidden></span><div class="track-copy"><strong ${role('track-title')}></strong><span class="subtle" ${role('track-artist')}></span><div class="time-row"><span ${role('track-time')}>-</span><span ${role('track-bites')} hidden></span><span>Stationheadを開く</span></div><div class="progress" aria-hidden="true"><i ${role('track-bar')}></i></div></div></a>
    </article>
    <article class="card queue-card">
      <div class="section-head queue-head"><div><p class="kicker">UP NEXT</p><h2>今後の再生予定</h2></div><span class="pill" ${role('queue-count')}>-</span></div>
      <div class="queue" ${role('queue')} aria-live="polite"></div>
    </article>
  </section>`;
}

function currentPanel() {
  return `<section class="stationhead-channel-panel" data-stationhead-panel="current">
    <section class="metrics current-metrics" aria-label="現在の指標">${metric('オンライン', 'online', true)}${metric('総再生数', 'streams')}${metric('総メンバー数', 'members')}</section>
    <section class="card chart-card chart-panel"><div class="section-head chart-head"><div><p class="kicker">LIVE</p><h2>過去24時間</h2></div><small class="subtle">5分単位</small></div><canvas class="shared-dashboard-canvas" ${role('live-chart')} width="960" height="360" aria-label="過去24時間のオンライン人数と再生数増加"></canvas><div class="chart-detail" ${role('live-detail')}></div></section>
    ${playbackCards()}
  </section>`;
}

function historyPanel() {
  return `<section class="stationhead-channel-panel" data-stationhead-panel="history" hidden>
    <section class="card chart-card chart-panel"><div class="section-head chart-head"><div><p class="kicker">HISTORY</p><h2>日次推移</h2></div></div><div class="legend" ${role('daily-legend')}></div><canvas class="shared-dashboard-canvas" ${role('daily-chart')} width="960" height="360" aria-label="日次の同接と再生数増加"></canvas></section>
    <section class="card data-panel"><div class="section-head history-table-head"><div><p class="kicker">DATA</p><h2 ${role('history-table-title')}>日次データ</h2></div><div class="history-granularity-toggle" role="group" aria-label="一覧表示単位"><button type="button" class="is-selected" data-history-table-mode="daily" aria-pressed="true">日次</button><button type="button" data-history-table-mode="weekly" aria-pressed="false">週次</button></div></div><div class="table-wrap scrollable-table"><table class="shared-numeric-table daily-stats-table"><thead><tr><th>日付</th><th>平均同接</th><th>最小</th><th>最大</th><th>開始再生</th><th>終了再生</th><th>増加</th><th>開始メンバー</th><th>終了メンバー</th><th>増加</th></tr></thead><tbody ${role('daily-tbody')}></tbody></table></div></section>
  </section>`;
}

function playedTracksPanel() {
  return `<section class="stationhead-channel-panel" data-stationhead-panel="played-tracks" hidden>
    <section class="controls card played-tracks-controls" aria-label="再生履歴の表示設定"><div class="played-tracks-period-scroller"><div class="played-tracks-period-strip" ${role('played-periods')} role="list"></div></div><label class="played-tracks-week-toggle"><input ${role('played-week')} type="checkbox"><span>週表示</span></label></section>
    <section class="summary-cards played-tracks-summary" aria-label="再生履歴集計概要">${summaryItem('総再生回数', 'played-total')}${summaryItem('楽曲数', 'played-unique')}</section>
    <section class="card chart-card chart-panel"><div class="section-head chart-head"><div><p class="kicker">TOP TRACKS</p><h2>曲別再生回数 TOP15</h2></div></div><div class="played-tracks-chart-wrap"><canvas class="shared-dashboard-canvas" ${role('played-chart')} width="960" height="420" aria-label="曲別再生回数上位15曲"></canvas></div></section>
    <section class="card data-panel"><div class="section-head"><div><p class="kicker">DATA</p><h2>楽曲別再生一覧</h2></div></div><div class="table-wrap table-fit-mobile scrollable-table"><table class="shared-numeric-table played-tracks-table sticky-first-column"><thead><tr><th>曲名</th><th>回数</th><th>割合</th></tr></thead><tbody ${role('played-tbody')}></tbody></table></div></section>
  </section>`;
}

function likesPanel() {
  return `<section class="stationhead-channel-panel" data-stationhead-panel="likes" hidden>
    <section class="summary-cards" aria-label="いいね集計概要">${summaryItem('楽曲数', 'likes-count')}${summaryItem('最終取得', 'likes-latest')}</section>
    <section class="card data-panel"><div class="section-head"><div><p class="kicker">TOP 10</p><h2>いいねランキング</h2></div></div><ol class="like-ranking-list" ${role('likes-ranking')}></ol></section>
    <section class="card data-panel"><div class="section-head"><div><p class="kicker">DATA</p><h2>いいね一覧</h2></div><button type="button" class="csv-button" ${role('likes-csv')}>CSV</button></div><div class="table-wrap scrollable-table"><table class="shared-numeric-table sticky-first-column"><thead><tr><th>順位</th><th>曲名</th><th>アーティスト</th><th>最新いいね数</th><th>最終取得</th></tr></thead><tbody ${role('likes-tbody')}></tbody></table></div></section>
  </section>`;
}

function broadcastsPanel() {
  return `<section class="stationhead-channel-panel" data-stationhead-panel="broadcasts" hidden>
    <section class="summary-cards" aria-label="リスパ集計概要">${summaryItem('開催数', 'broadcast-count')}${summaryItem('平均同接', 'broadcast-average')}${summaryItem('最大同接', 'broadcast-maximum')}${summaryItem('平均時間', 'broadcast-duration')}</section>
    <section class="card chart-card chart-panel"><div class="section-head chart-head"><div><p class="kicker">LISTENING PARTY</p><h2>同接推移</h2></div></div><details class="series-selector" ${role('broadcast-series-selector')}><summary>表示するイベント</summary><div class="series-selector-options" ${role('broadcast-series-options')}></div></details><div class="legend compact-series-legend" ${role('broadcast-legend')}></div><canvas class="shared-dashboard-canvas" ${role('broadcast-chart')} width="960" height="360" aria-label="公式リスパの同接推移"></canvas><p class="shared-empty" ${role('broadcast-chart-empty')} hidden>グラフデータがありません。</p></section>
    <section class="card data-panel"><div class="section-head"><div><p class="kicker">DATA</p><h2>リスパ一覧</h2></div></div><div class="table-wrap scrollable-table"><table class="shared-numeric-table official-party-table sticky-first-column"><thead><tr><th>日付</th><th>時間帯</th><th>所要時間</th><th>平均同接</th><th>最小同接</th><th>最大同接</th><th>楽曲数</th><th>推定再生数</th><th class="secondary-column">放送内容</th><th>イベント名</th></tr></thead><tbody ${role('broadcast-tbody')}></tbody></table></div></section>
  </section>`;
}

function stationheadTabs() {
  return dashboardModeTabs(STATIONHEAD_CHANNEL_TABS.map((item, index) => ({ ...item, active: index === 0 })), {
    dataAttribute: 'stationhead-section', className: 'stationhead-subtabs', ariaLabel: 'Stationhead表示切替', role: 'tablist', selection: 'current',
  });
}

export function stationheadChannelMarkup({ showTabs = true } = {}) {
  return `${showTabs ? stationheadTabs() : ''}<p class="notice" ${role('notice')} role="status" hidden></p>${currentPanel()}${historyPanel()}${playedTracksPanel()}${likesPanel()}${broadcastsPanel()}`;
}

export function mountStationheadChannelShell({ id, hidden = true, anchorIds = [], showTabs = true } = {}) {
  return mountDashboardView({ id, className: 'stationhead-channel-view', hidden, anchorIds, html: stationheadChannelMarkup({ showTabs }) });
}
