export const STATIONHEAD_CHANNEL_TABS = Object.freeze([
  { value: 'current', label: '現在' },
  { value: 'history', label: '過去' },
  { value: 'played-tracks', label: '再生履歴' },
  { value: 'likes', label: 'いいね' },
  { value: 'broadcasts', label: 'リスパ' },
]);

export const ALL_CHANNEL_SECTIONS = Object.freeze(STATIONHEAD_CHANNEL_TABS.map(({ value }) => value));
