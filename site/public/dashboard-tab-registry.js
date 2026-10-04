import { mountDashboardTab } from './dashboard-ui-common.js?v=20260930.2';
import { STATIONHEAD_CHANNEL_TABS } from './stationhead-channel-tabs.js?v=20261004.2';

const BUDDIES_ROUTES = Object.freeze({
  current: Object.freeze({ view: 'current', active: true }),
  history: Object.freeze({ view: 'history', mode: 'daily' }),
  'played-tracks': Object.freeze({ view: 'played-tracks' }),
  likes: Object.freeze({ view: 'likes', mode: 'likes' }),
  broadcasts: Object.freeze({ view: 'history', mode: 'broadcasts' }),
});

const BASE_TABS = Object.freeze([
  ...STATIONHEAD_CHANNEL_TABS.map(({ value, label }) => ({ ...BUDDIES_ROUTES[value], label })),
  { view: 'spotify', label: 'Spotify' },
  { view: 'history', mode: 'ranking', label: 'リーダーボード' },
]);

for (const tab of BASE_TABS) mountDashboardTab(tab);

document.getElementById('modeTabs')?.classList.add('stationhead-subtabs');
