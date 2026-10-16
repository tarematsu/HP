// Presentation labels only. Canonical Spotify IDs and collection configuration
// remain in packages/sh-shared/spotify-charts.mjs.
export const SPOTIFY_PLAYLIST_TABS = Object.freeze([
  ['spotify-japan-rising', 'Spotify Japan 急上昇チャート'],
  ['idol-pop-japan', 'アイドルポップ：ジャパン'],
  ['viral-hits', 'Viral Hits Japan'],
  ['tokyo-super-hits', 'Tokyo Super Hits!'],
  ['j-pop-hits', 'J-Pop Hits'],
  ['teen-culture', 'Teen Culture'],
  ['buzz-tracker', 'Buzz Tracker #バズトラ'],
  ['hot-hits-japan', 'Hot Hits Japan'],
  ['new-music-wednesday', 'New Music Wednesday'],
  ['new-music-friday-japan', 'New Music Friday Japan'],
  ['equal-japan', 'EQUAL Japan'],
  ['radar-early-noise', 'RADAR: Early Noise'],
  ['fresh-finds-japan', 'Fresh Finds Japan'],
  ['kirakira-pop-japan', 'キラキラポップ：ジャパン'],
  ['j-rock-on', 'J-Rock ON!!'],
  ['k-pop-on', 'K-Pop ON! (온)'],
].map(([slug, label]) => Object.freeze({
  slug, label,
  chartId: slug === 'viral-hits' ? 'viral-hits-jp-daily' : `playlist-${slug}-daily`,
})));
