import {
  mountMusicServiceView,
  musicServiceSection,
  musicServiceTable,
} from './music-service-shell.js?v=20261004.2';

const artistTable = musicServiceTable({
  headers: ['アーティスト', '登録者', '月間視聴者', '総視聴回数', 'サービスID'],
  bodyId: 'youtubeMusicArtistBody',
});

const releaseTable = musicServiceTable({
  headers: ['アーティスト', '作品', '種別', '年'],
  bodyId: 'youtubeMusicReleaseBody',
});

const trackTable = musicServiceTable({
  headers: ['アーティスト', '曲名', '再生数', 'アルバム', 'videoId'],
  bodyId: 'youtubeMusicTrackBody',
});

const playlistTable = musicServiceTable({
  kind: 'playlist',
  headers: ['プレイリスト', '種別', '対象曲数'],
  bodyId: 'youtubeMusicPlaylistBody',
});

mountMusicServiceView({
  viewId: 'youtubeMusicView',
  className: 'youtube-music-view',
  noticeId: 'youtubeMusicNotice',
  groupLabels: { plays: '再生数', audience: '月間視聴者', subscribers: '登録者', releases: '作品', playlists: 'プレイリスト' },
  meta: { valueId: 'youtubeMusicUpdated', cadence: '毎日0:00' },
  sections: [
    musicServiceSection({ id: 'youtubeMusicArtistSection', group: 'audience', title: 'YouTube Music アーティスト', bodyHtml: '<div id="youtubeAudienceChart"></div>' + artistTable }),
    musicServiceSection({ id: 'youtubeMusicReleaseSection', group: 'releases', title: 'YouTube Music アルバム・シングル', bodyHtml: '<div id="youtubeReleaseChart"></div>' + releaseTable }),
    musicServiceSection({ id: 'youtubeMusicTrackSection', group: 'plays', title: 'YouTube Music 楽曲', bodyHtml: '<div id="youtubePlaysChart"></div>' + trackTable }),
    musicServiceSection({ id: 'youtubeSubscribersSection', group: 'subscribers', title: 'YouTube Music 登録者', bodyHtml: '<div id="youtubeSubscribersChart"></div>' + musicServiceTable({ headers: ['アーティスト', '登録者'], bodyId: 'youtubeSubscribersBody' }) }),
    musicServiceSection({ id: 'youtubeMusicPlaylistSection', group: 'playlists', title: 'YouTube Music 公開プレイリスト', bodyHtml: '<div id="youtubePlaylistChart"></div>' + playlistTable }),
  ],
});
