import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YOUTUBE_MUSIC_ARTIST_FILTER,
  YOUTUBE_MUSIC_SERVICE,
  parseYouTubeMusicArtistPage,
  parseYouTubeMusicArtistSearch,
} from '../src/regional-music-youtube-music.js';

function artistResult(name, browseId) {
  return {
    musicResponsiveListItemRenderer: {
      flexColumns: [{
        musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: name }] } },
      }],
      navigationEndpoint: { browseEndpoint: { browseId } },
    },
  };
}

test('YouTube Music collector uses the public artist search filter and stable service key', () => {
  assert.equal(YOUTUBE_MUSIC_SERVICE, 'youtube_music');
  assert.equal(YOUTUBE_MUSIC_ARTIST_FILTER, 'EgWKAQIgAWoMEA4QChADEAQQCRAF');
});

test('artist search requires an exact Sakamichi identity and ignores cover lookalikes', () => {
  const payload = {
    contents: [
      artistResult('櫻坂46 Cover Project', 'UC-cover'),
      artistResult('櫻坂46', 'UC-sakura'),
    ],
  };
  assert.deepEqual(parseYouTubeMusicArtistSearch(payload, 'sakurazaka46'), {
    browseId: 'UC-sakura',
    name: '櫻坂46',
  });
});

test('artist page parses public monthly audience, total views, songs, releases and artist playlist', () => {
  const payload = {
    header: {
      musicImmersiveHeaderRenderer: {
        title: { runs: [{ text: '櫻坂46' }] },
        monthlyListenerCount: { runs: [{ text: '1.23M monthly audience' }] },
        subscriptionButton: {
          subscribeButtonRenderer: {
            channelId: 'UC-sakura-channel',
            subscriberCountText: { runs: [{ text: '456K subscribers' }] },
          },
        },
      },
    },
    contents: [{
      musicDescriptionShelfRenderer: {
        subheader: { runs: [{ text: '1,234,567 views' }] },
      },
    }, {
      musicShelfRenderer: {
        title: {
          runs: [{
            text: 'Songs',
            navigationEndpoint: { browseEndpoint: { browseId: 'VLPL-sakura-songs' } },
          }],
        },
        contents: [{
          musicResponsiveListItemRenderer: {
            playlistItemData: { videoId: 'video-1' },
            flexColumns: [{
              musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song One' }] } },
            }, {
              musicResponsiveListItemFlexColumnRenderer: {
                text: {
                  runs: [{ text: '櫻坂46' }, { text: ' • ' }, {
                    text: 'Album One',
                    navigationEndpoint: { browseEndpoint: { browseId: 'MPRE-album-1' } },
                  }],
                },
              },
            }],
            overlay: {
              musicItemThumbnailOverlayRenderer: {
                content: {
                  musicPlayButtonRenderer: {
                    playNavigationEndpoint: {
                      watchEndpoint: {
                        videoId: 'video-1',
                        watchEndpointMusicSupportedConfigs: {
                          watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }],
      },
    }, {
      musicTwoRowItemRenderer: {
        title: { runs: [{ text: 'Album One' }] },
        subtitle: { runs: [{ text: 'Album • 2026' }] },
        navigationEndpoint: { browseEndpoint: { browseId: 'MPRE-album-1' } },
      },
    }],
  };

  const parsed = parseYouTubeMusicArtistPage(payload, 'sakurazaka46');
  assert.equal(parsed.name, '櫻坂46');
  assert.equal(parsed.subscribers, 456000);
  assert.equal(parsed.monthlyAudience, 1230000);
  assert.equal(parsed.totalViews, 1234567);
  assert.deepEqual(parsed.tracks, [{
    service_track_id: 'video-1',
    title: 'Song One',
    album_name: 'Album One',
    track_url: 'https://music.youtube.com/watch?v=video-1',
  }]);
  assert.equal(parsed.releases[0].service_release_id, 'MPRE-album-1');
  assert.equal(parsed.releases[0].release_type, 'album');
  assert.equal(parsed.releases[0].release_year, 2026);
  assert.deepEqual(parsed.playlists[0].trackIds, ['video-1']);
  assert.equal(parsed.playlists[0].service_playlist_id, 'PL-sakura-songs');
});

test('artist page rejects a mismatched identity even if the response shape is valid', () => {
  assert.throws(() => parseYouTubeMusicArtistPage({
    header: {
      musicImmersiveHeaderRenderer: {
        title: { runs: [{ text: '櫻坂46 Cover Project' }] },
        subscriptionButton: { subscribeButtonRenderer: {} },
      },
    },
  }, 'sakurazaka46'), /identity mismatch/);
});
