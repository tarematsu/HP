import { mountDashboardTab } from './dashboard-ui-common.js?v=20260930.2';
import { STATIONHEAD_CHANNEL_TABS } from './stationhead-channel-tabs.js?v=20261004.2';

const BUDDIES_ROUTES = {
  current: { view: 'current', label: '現在', active: true },
  history: { view: 'history', mode: 'daily', label: '過去' },
  'played-tracks': { view: 'played-tracks', label: '再生履歴' },
  likes: { view: 'likes', mode: 'likes', label: 'いいね' },
  broadcasts: { view: 'history', mode: 'broadcasts', label: 'リスパ' },
};

const BASE_TABS = [
  ...STATIONHEAD_CHANNEL_TABS.map(({ value, label }) => ({ ...BUDDIES_ROUTES[value], label })),
  { view: 'spotify', label: 'Spotify' },
  { view: 'history', mode: 'ranking', label: 'リーダーボード' },
];

for (const tab of BASE_TABS) mountDashboardTab(tab);

document.getElementById('modeTabs')?.classList.add('stationhead-subtabs');
