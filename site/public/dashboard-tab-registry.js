import { mountDashboardTab } from './dashboard-ui-common.js?v=20260930.2';

const BASE_TABS = Object.freeze([
  { view: 'current', label: '現在', active: true },
  { view: 'history', mode: 'daily', label: '過去' },
  { view: 'first-week', label: '初週比較' },
  { view: 'played-tracks', label: '再生履歴' },
  { view: 'spotify', label: 'Spotify' },
  { view: 'likes', mode: 'likes', label: 'いいね' },
  { view: 'history', mode: 'ranking', label: 'リーダーボード' },
  { view: 'history', mode: 'broadcasts', label: 'リスパ' },
]);

for (const tab of BASE_TABS) mountDashboardTab(tab);
