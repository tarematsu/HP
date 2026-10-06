export const HISTORY_MODES = Object.freeze(new Set(['daily', 'weekly', 'monthly', 'broadcasts']));

const stationheadFunctions = Object.freeze([
  { mode: 'current', label: '現在' },
  { mode: 'daily', label: '日次' },
  { mode: 'weekly', label: '週次' },
  { mode: 'monthly', label: '月次' },
  { mode: 'played-tracks', label: '再生履歴' },
  { mode: 'likes', label: 'いいね' },
  { mode: 'broadcasts', label: 'リスパ' },
  { mode: 'ranking', label: 'リーダーボード' },
  { mode: 'followers', label: 'フォロワー' },
]);

export const NAVIGATION = Object.freeze([
  {
    id: 'stationhead', label: 'Stationhead', sources: Object.freeze([
      { id: 'buddies', label: 'Buddies', defaultMode: 'current', functions: stationheadFunctions },
      { id: 'hinata', label: 'Ohisama', defaultMode: 'hinata', functions: Object.freeze([{ mode: 'hinata', label: '統計' }]) },
      { id: 'nogizaka', label: 'Nogizaka', defaultMode: 'nogizaka', functions: Object.freeze([{ mode: 'nogizaka', label: 'リスパ' }]) },
    ]),
  },
  {
    id: 'subscriptions', label: '音楽ストリーミングサービス', sources: Object.freeze([
      { id: 'spotify', label: 'Spotify', defaultMode: 'spotify', functions: Object.freeze([{ mode: 'spotify', label: 'Spotify' }]) },
      { id: 'apple-music', label: 'Apple Music', defaultMode: 'apple-music', functions: Object.freeze([{ mode: 'apple-music', label: 'Apple Music' }]) },
      { id: 'amazon-music', label: 'Amazon Music', defaultMode: 'amazon-music', functions: Object.freeze([{ mode: 'amazon-music', label: 'Amazon Music' }]) },
      { id: 'youtube-music', label: 'YouTube Music', defaultMode: 'youtube-music', functions: Object.freeze([{ mode: 'youtube-music', label: 'YouTube Music' }]) },
      { id: 'kkbox', label: '🇹🇼KKBOX', defaultMode: 'kkbox', functions: Object.freeze([{ mode: 'kkbox', label: 'KKBOX' }]) },
      { id: 'qq_music', label: '🇨🇳QQ音乐', defaultMode: 'qq_music', functions: Object.freeze([{ mode: 'qq_music', label: 'QQ音乐' }]) },
      { id: 'kugou_music', label: '🇨🇳酷狗音乐', defaultMode: 'kugou_music', functions: Object.freeze([{ mode: 'kugou_music', label: '酷狗音乐' }]) },
    ]),
  },
]);

const lazy = (viewId, moduleId, loadExport, noticeId, errorLabel, errorMessage, loadArgs) => Object.freeze({
  kind: 'lazy', viewId, moduleId, loadExport, noticeId, errorLabel, errorMessage, ...(loadArgs ? { loadArgs } : {}),
});

export const ROUTES = Object.freeze({
  current: Object.freeze({ kind: 'stationhead', panel: 'current', viewId: 'currentView' }),
  'played-tracks': Object.freeze({ kind: 'stationhead', panel: 'played-tracks', viewId: 'currentView' }),
  likes: Object.freeze({ kind: 'stationhead', panel: 'likes', viewId: 'currentView' }),
  daily: Object.freeze({ kind: 'history', viewId: 'historyView' }),
  weekly: Object.freeze({ kind: 'history', viewId: 'historyView' }),
  monthly: Object.freeze({ kind: 'history', viewId: 'historyView' }),
  broadcasts: Object.freeze({ kind: 'history', viewId: 'historyView', firstWeek: true }),
  hinata: lazy('hinataView', 'hinata', 'loadHinataView', 'hinataNotice', 'hinata', '日向坂データの初期化に失敗しました。再読み込みしてください。'),
  ranking: lazy('leaderboardView', 'ranking', 'loadLeaderboardView', 'leaderboardNotice', 'stationhead leaderboard', 'リーダーボードデータの初期化に失敗しました。再読み込みしてください。', { source: 'stationhead' }),
  followers: lazy('followersView', 'followers', 'loadFollowersView', 'followersNotice', 'followers', 'フォロワーデータの初期化に失敗しました。再読み込みしてください。', { source: 'stationhead' }),
  spotify: lazy('spotifyView', 'spotify', 'loadSpotifyView', 'spotifyNotice', 'spotify', 'Spotify再生数の初期化に失敗しました。再読み込みしてください。'),
  'amazon-music': lazy('amazonMusicView', 'amazon-music', 'loadAmazonMusicView', 'amazonMusicNotice', 'amazon music', 'Amazon Musicデータの初期化に失敗しました。再読み込みしてください。'),
  'apple-music': lazy('appleMusicView', 'apple-music', 'loadAppleMusicView', 'appleMusicNotice', 'apple music', 'Apple Musicデータの初期化に失敗しました。再読み込みしてください。'),
  'youtube-music': lazy('youtubeMusicView', 'youtube-music', 'loadYoutubeMusicView', 'youtubeMusicNotice', 'youtube music', 'YouTube Musicデータの初期化に失敗しました。再読み込みしてください。'),
  kkbox: lazy('kkboxView', 'kkbox', 'loadKkboxView', 'kkboxNotice', 'kkbox', 'KKBOXデータの初期化に失敗しました。再読み込みしてください。'),
  qq_music: lazy('qqMusicView', 'qq_music', 'loadQqMusicView', 'qqMusicNotice', 'qq music', 'QQ音乐データの初期化に失敗しました。再読み込みしてください。'),
  kugou_music: lazy('kugouMusicView', 'kugou_music', 'loadKugouMusicView', 'kugouMusicNotice', 'kugou music', '酷狗音乐データの初期化に失敗しました。再読み込みしてください。'),
  nogizaka: lazy('nogizakaListeningPartyView', 'nogizaka', 'loadNogizakaListeningPartyView', 'nogizakaListeningPartyNotice', 'nogizaka listening party', '乃木坂公式リスパデータの初期化に失敗しました。再読み込みしてください。'),
});

const modeNavigation = new Map();
for (const section of NAVIGATION) {
  for (const source of section.sources) {
    for (const item of source.functions) modeNavigation.set(item.mode, { section, source, item, route: ROUTES[item.mode] });
  }
}

export const VIEW_MODES = Object.freeze(new Set(modeNavigation.keys()));
export const VIEW_IDS = Object.freeze([...new Set(Object.values(ROUTES).map((route) => route.viewId))]);

export function navigationForMode(mode) {
  return modeNavigation.get(String(mode || '')) || modeNavigation.get('current');
}
export function routeForMode(mode) { return navigationForMode(mode)?.route || ROUTES.current; }
export function sourceById(section, sourceId) { return section?.sources.find((source) => source.id === sourceId) || section?.sources[0] || null; }
export function functionByMode(source, mode) { return source?.functions.find((item) => item.mode === mode) || source?.functions[0] || null; }
