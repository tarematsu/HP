import {
  dashboardLegend,
  dashboardMetric,
  dashboardMetrics,
  dashboardSectionHead,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import { stationheadPlaybackCards } from './stationhead-playback-shell.js?v=20261001.1';

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
      ${stationheadPlaybackCards({
        stationUrl: 'https://stationhead.com/c/buddies',
        ids: {
          host: 'host',
          link: 'nowPlayingLink',
          fallback: 'trackFallback',
          image: 'trackImage',
          title: 'trackTitle',
          artist: 'trackArtist',
          time: 'trackTime',
          bites: 'trackBites',
          hint: 'spotifyHint',
          bar: 'trackBar',
          queueCount: 'queueCount',
          queue: 'queue',
          status: 'statusMessage',
        },
      })}`,
  },
});
