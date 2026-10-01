import {
  dashboardDataCard,
  dashboardNotice,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import { musicServiceSection } from './music-service-shell.js?v=20261001.1';

mountDashboardShell({
  view: {
    id: 'youtubeMusicView',
    className: 'youtube-music-view music-service-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${dashboardNotice({ id: 'youtubeMusicNotice' })}
      ${musicServiceSection({
        id: 'youtubeMusicStatusSection',
        kicker: 'YOUTUBE MUSIC',
        title: 'YouTube Music',
        bodyHtml: dashboardDataCard({
          title: '収集状態',
          className: 'music-service-panel',
          bodyHtml: '<p class="music-service-playlist-note">専用のYouTube Music read modelはまだ接続されていません。</p>',
        }),
      })}`,
  },
});
