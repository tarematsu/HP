const HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']);
const REGIONAL_MUSIC_MODES = new Set('genie bugs joox nhaccuatui anghami melon qq_music netease_cloud_music kugou_music naver_vibe flo yandex_music boomplay plern fungjai zing_mp3 jiosaavn gaana langit_musik'.split(' '));
const REGIONAL_MUSIC_VIEW = Object.freeze({
  viewId: 'regionalMusicView',
  shell: () => import(location.origin + '/regional-music-shell.js?v=20261002.4'),
  runtime: () => import(location.origin + '/regional-music.js?v=20261002.6'),
  noticeId: 'regionalMusicNotice',
});

const LAZY_VIEWS = Object.freeze({
  hinata: {
    viewId: 'hinataView',
    runtime: () => import(location.origin + '/hinata.js?v=20260930.5'),
    loadExport: 'loadHinataView',
    noticeId: 'hinataNotice',
    errorLabel: 'hinata',
    errorMessage: '日向坂データの初期化に失敗しました。再読み込みしてください。',
  },
  followers: {
    viewId: 'followersView',
    runtime: () => import(location.origin + '/followers.js?v=20260930.3'),
    loadExport: 'loadFollowersView',
    noticeId: 'followersNotice',
    errorLabel: 'followers',
    errorMessage: 'フォロワーデータの初期化に失敗しました。再読み込みしてください。',
  },
  'played-tracks': {
    viewId: 'playedTracksView',
    shell: () => import('/played-tracks-shell.js?v=20260928.1'),
    runtime: () => import('/played-tracks.js?v=20260927.2'),
    noticeId: 'playedTracksNotice',
    errorLabel: 'played tracks',
    errorMessage: '再生履歴データの初期化に失敗しました。再読み込みしてください。',
  },
  spotify: {
    viewId: 'spotifyView',
    shell: () => import('/spotify-shell.js?v=20260929.1'),
    runtime: () => import('/spotify.js?v=20260929.1'),
    loadExport: 'loadSpotifyView',
    noticeId: 'spotifyNotice',
    errorLabel: 'spotify',
    errorMessage: 'Spotify再生数の初期化に失敗しました。再読み込みしてください。',
  },
  'amazon-music': {
    viewId: 'amazonMusicView',
    shell: () => import('/amazon-music-shell.js?v=20261002.3'),
    runtime: () => import('/amazon-music.js?v=20261002.3'),
    loadExport: 'loadAmazonMusicView',
    noticeId: 'amazonMusicNotice',
    errorLabel: 'amazon music',
    errorMessage: 'Amazon Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  'apple-music': {
    viewId: 'appleMusicView',
    shell: () => import('/apple-music-shell.js?v=20261001.1'),
    runtime: () => import(location.origin + '/apple-music.js?v=20261001.1'),
    loadExport: 'loadAppleMusicView',
    noticeId: 'appleMusicNotice',
    errorLabel: 'apple music',
    errorMessage: 'Apple Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  'youtube-music': {
    viewId: 'youtubeMusicView',
    shell: () => import(location.origin + '/youtube-music-shell.js?v=20261002.3'),
    runtime: () => import(location.origin + '/youtube-music.js?v=20261002.3'),
    loadExport: 'loadYoutubeMusicView',
    noticeId: 'youtubeMusicNotice',
    errorLabel: 'youtube music',
    errorMessage: 'YouTube Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  nogizaka: {
    viewId: 'nogizakaListeningPartyView',
    shell: () => import('/nogizaka-listening-party-shell.js?v=20260930.1'),
    runtime: () => import('/nogizaka-listening-party.js?v=20260930.1'),
    loadExport: 'loadNogizakaListeningPartyView',
    noticeId: 'nogizakaListeningPartyNotice',
    errorLabel: 'nogizaka listening party',
    errorMessage: '乃木坂公式リスパデータの初期化に失敗しました。再読み込みしてください。',
  },
  likes: {
    viewId: 'likesView',
    shell: () => import('/likes-shell.js?v=20260927.1'),
    runtime: () => import('/likes.js?v=20260927.1'),
    loadExport: 'loadLikesView',
    noticeId: 'likesNotice',
    errorLabel: 'likes',
    errorMessage: 'いいねデータの初期化に失敗しました。再読み込みしてください。',
  },
  leaderboard: {
    viewId: 'leaderboardView',
    shell: () => import('/leaderboard-shell.js?v=20260930.2'),
    runtime: () => import('/leaderboard.js?v=20260930.3'),
    loadExport: 'loadLeaderboardView',
    noticeId: 'leaderboardNotice',
    errorLabel: 'leaderboard',
    errorMessage: 'リーダーボードの初期化に失敗しました。再読み込みしてください。',
  },
});

function lazyConfig(mode) {
  if (REGIONAL_MUSIC_MODES.has(mode)) return REGIONAL_MUSIC_VIEW;
  return LAZY_VIEWS[mode] || null;
}

async function ensureLazyView(mode) {
  const config = lazyConfig(mode);
  if (!config) return null;
  try {
    if (config.shell) await config.shell();
    const runtime = config.runtime ? await config.runtime() : null;
    if (runtime && config.loadExport && typeof runtime[config.loadExport] === 'function') await runtime[config.loadExport](mode);
    else if (runtime && REGIONAL_MUSIC_MODES.has(mode) && typeof runtime.loadRegionalMusicView === 'function') await runtime.loadRegionalMusicView(mode);
    return config.viewId;
  } catch (error) {
    console.error(`Failed to load ${config.errorLabel || mode}`, error);
    const notice = document.getElementById(config.noticeId);
    if (notice) {
      notice.textContent = config.errorMessage || 'データの読み込みに失敗しました。';
      notice.classList.add('error');
    }
    return config.viewId;
  }
}

function shouldSkipMode(mode) {
  return HISTORY_MODES.has(mode);
}

export async function prepareDashboardMode(mode) {
  if (shouldSkipMode(mode)) return null;
  return ensureLazyView(mode);
}
