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
    id: 'stationhead',
    label: 'Stationhead',
    sources: Object.freeze([
      { id: 'buddies', label: 'Buddies', defaultMode: 'current', functions: stationheadFunctions },
      { id: 'hinata', label: 'Ohisama', defaultMode: 'hinata', functions: Object.freeze([{ mode: 'hinata', label: '統計' }]) },
      { id: 'nogizaka', label: 'Nogizaka', defaultMode: 'nogizaka', functions: Object.freeze([{ mode: 'nogizaka', label: 'リスパ' }]) },
    ]),
  },
  {
    id: 'subscriptions',
    label: '音楽ストリーミングサービス',
    sources: Object.freeze([
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

const modeNavigation = new Map();
for (const section of NAVIGATION) {
  for (const source of section.sources) {
    for (const item of source.functions) modeNavigation.set(item.mode, { section, source, item });
  }
}

export const VIEW_MODES = Object.freeze(new Set(modeNavigation.keys()));

export function navigationForMode(mode) {
  return modeNavigation.get(String(mode || '')) || modeNavigation.get('current');
}

export function sourceById(section, sourceId) {
  return section?.sources.find((source) => source.id === sourceId) || section?.sources[0] || null;
}

export function functionByMode(source, mode) {
  return source?.functions.find((item) => item.mode === mode) || source?.functions[0] || null;
}
