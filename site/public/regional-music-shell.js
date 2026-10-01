import {
  dashboardDataCard,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import {
  musicServiceMeta,
  musicServiceSection,
} from './music-service-shell.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '状態', valueId: 'regionalMusicStatus' }),
  dashboardSummaryItem({ label: 'アーティスト', valueId: 'regionalMusicArtistCount' }),
  dashboardSummaryItem({ label: '楽曲', valueId: 'regionalMusicTrackCount' }),
  dashboardSummaryItem({ label: 'プレイリスト', valueId: 'regionalMusicPlaylistCount' }),
], { className: 'music-service-summary regional-music-summary', ariaLabel: '地域音楽サービス概要' });

const artistTable = dashboardTable({
  className: 'regional-music-table regional-music-artist-table music-service-track-table',
  headers: ['アーティスト', 'フォロワー', 'いいね', 'サービスID'],
  bodyId: 'regionalMusicArtistBody',
  wrapClassName: 'regional-music-table-wrap',
});

const trackTable = dashboardTable({
  className: 'regional-music-table regional-music-track-table music-service-track-table',
  headers: ['アーティスト', '曲名', '再生数', 'リスナー', 'いいね', 'コメント', '順位'],
  bodyId: 'regionalMusicTrackBody',
  wrapClassName: 'regional-music-table-wrap',
});

const playlistTable = dashboardTable({
  className: 'regional-music-table regional-music-playlist-table music-service-playlist-table',
  headers: ['プレイリスト', '種別', '所有者', '対象曲数'],
  bodyId: 'regionalMusicPlaylistBody',
  wrapClassName: 'regional-music-table-wrap',
});

const healthPanel = dashboardDataCard({
  title: '収集状態',
  kicker: 'COLLECTOR',
  className: 'regional-music-health music-service-panel',
  bodyHtml: '<dl id="regionalMusicHealth" class="regional-music-health-list"></dl>',
});

mountDashboardShell({
  view: {
    id: 'regionalMusicView',
    className: 'regional-music-view music-service-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      ${musicServiceMeta({ label: '更新', valueId: 'regionalMusicUpdated' })}
      ${dashboardNotice({ id: 'regionalMusicNotice' })}
      <div class="regional-music-title-row">
        <div><p class="kicker">REGIONAL MUSIC</p><h2 id="regionalMusicTitle">-</h2></div>
        <span id="regionalMusicRegion" class="regional-music-region"></span>
      </div>
      ${summary}
      ${musicServiceSection({ id: 'regionalMusicHealthSection', kicker: 'STATUS', title: '状態', bodyHtml: healthPanel })}
      ${musicServiceSection({ id: 'regionalMusicArtistSection', kicker: 'ARTISTS', title: 'アーティスト', bodyHtml: artistTable })}
      ${musicServiceSection({ id: 'regionalMusicTrackSection', kicker: 'TRACKS', title: '楽曲', bodyHtml: trackTable })}
      ${musicServiceSection({ id: 'regionalMusicPlaylistSection', kicker: 'PLAYLISTS', title: 'プレイリスト', bodyHtml: playlistTable })}`,
  },
});
