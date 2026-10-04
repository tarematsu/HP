import { STATIONHEAD_CHANNEL_TABS } from './stationhead-channel-model.js?v=20261004.1';

const BUDDIES_ROUTES = {
  current: { view: 'current', active: true },
  history: { view: 'history', mode: 'daily' },
  'played-tracks': { view: 'played-tracks' },
  likes: { view: 'likes', mode: 'likes' },
  broadcasts: { view: 'history', mode: 'broadcasts' },
};

const tabs = document.getElementById('modeTabs');
if (tabs) {
  const fragment = document.createDocumentFragment();
  for (const { value, label } of STATIONHEAD_CHANNEL_TABS) {
    const route = BUDDIES_ROUTES[value];
    if (!route) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.view = route.view;
    if (route.mode) button.dataset.mode = route.mode;
    button.textContent = label;
    if (route.active) {
      button.className = 'active';
      button.setAttribute('aria-current', 'page');
    }
    fragment.append(button);
  }
  tabs.replaceChildren(fragment);
  tabs.classList.add('stationhead-subtabs');
}
