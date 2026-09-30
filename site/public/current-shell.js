import {
  dashboardLegend,
  dashboardMetric,
  dashboardMetrics,
  dashboardSectionHead,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const currentMetrics = dashboardMetrics([
  dashboardMetric({
    label: 'オンライン',
    valueId: 'online',
    className: 'featured',
    extraHtml: '<div id="onlineYesterdayAvg" class="delta" hidden></div>',
  }),
  dashboardMetric({
    label: '総再生数',
    valueId: 'totalStreams',
    extraHtml: '<div id="streamsYesterdayDelta" class="delta" hidden></div><div id="streamsDayBeforeDelta" class="delta" hidden></div><div id="metricGoalCompact" class="metric-goal-compact"><span class="metric-goal-row">目標 <b id="streamGoal">-</b> 予想 <strong id="goalEta">-</strong></span></div>',
  }),
  dashboardMetric({
    label: '総メンバー数',
    valueId: 'members',
    extraHtml: '<div id="membersYesterdayDelta" class="delta" hidden></div><div id="membersDayBeforeDelta" class="delta" hidden></div><div id="membersThreeDaysAgoDelta" class="delta" hidden></div>',
  }),
], { ariaLabel: '現在の指標' });

const currentLegend = dashboardLegend({
  items: [
    '<span class="online-key">オンライン</span>',
    '<span class="stream-growth-key">再生数増加</span>',
  ],
});

mountDashboardShell({
  view: {
    id: 'currentView',
    hidden: false,
    html: `${currentMetrics}
      <section class="card chart-card">
        ${dashboardSectionHead({ trailingHtml: `${currentLegend}<small class="subtle">5分単位</small>`, className: 'chart-head' })}
        <canvas id="audienceChart" width="960" height="360" aria-label="過去24時間のオンライン人数"></canvas>
        <div id="currentChartDetail" class="chart-detail" data-current-chart-detail></div>
      </section>
      <section class="primary-grid">
        <article class="card now-card">
          ${dashboardSectionHead({ kicker: 'NOW PLAYING', title: '再生中の曲', trailingHtml: '<div id="host" class="host"></div>', className: 'now-head' })}
          <a id="nowPlayingLink" class="now-playing" href="https://stationhead.com/c/buddies" target="_blank" rel="noopener noreferrer" aria-disabled="false"><span class="track-visual" aria-hidden="true"><span id="trackFallback" class="track-fallback">♪</span><img id="trackImage" class="track-image" alt="" width="104" height="104" decoding="async" hidden></span><div class="track-copy"><strong id="trackTitle"></strong><span id="trackArtist" class="subtle"></span><div class="time-row"><span id="trackTime">-</span><span id="trackBites" hidden></span><span id="spotifyHint">Stationheadを開く</span></div><div class="progress" aria-hidden="true"><i id="trackBar"></i></div></div></a>
        </article>
        <article class="card queue-card">
          ${dashboardSectionHead({ kicker: 'UP NEXT', title: '今後の再生予定', trailingHtml: '<span id="queueCount" class="pill">-</span>', className: 'queue-head' })}
          <div id="queue" class="queue" aria-live="polite"></div>
        </article>
      </section>
      <p id="statusMessage" class="status-message" role="status" hidden></p>`,
  },
});
