import { STATIONHEAD_CHANNEL_TABS } from './stationhead-channel-model.js?v=20261004.1';

const BUDDIES_ROUTES = {
  current: { view: 'current', label: '現在', active: true },
  history: { view: 'history', mode: 'daily', label: '過去' },
  'played-tracks': { view: 'played-tracks', label: '再生履歴' },
  likes: { view: 'likes', mode: 'likes', label: 'いいね' },
  broadcasts: { view: 'history', mode: 'broadcasts', label: 'リスパ' },
};

const tabs = document.getElementById('modeTabs');
if (tabs) {
  const fragment = document.createDocumentFragment();
  const buttons = STATIONHEAD_CHANNEL_TABS.map(({ value, label }) => {
    const route = BUDDIES_ROUTES[value];
    if (!route) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.view = route.view;
    if (route.mode) button.dataset.mode = route.mode;
    button.textContent = label;
    if (route.active) {
      button.className = 'active';
      button.setAttribute('aria-current', 'page');
    }
    return button;
  }).filter(Boolean);
  fragment.append(...buttons);
  tabs.replaceChildren(fragment);
  tabs.classList.add('stationhead-subtabs');
}
