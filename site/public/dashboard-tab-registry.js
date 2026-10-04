const BASE_TABS = [
  { view: 'current', label: '現在', active: true },
  { view: 'history', mode: 'daily', label: '過去' },
  { view: 'played-tracks', label: '再生履歴' },
  { view: 'likes', mode: 'likes', label: 'いいね' },
  { view: 'history', mode: 'broadcasts', label: 'リスパ' },
];

const tabs = document.getElementById('modeTabs');
if (tabs) {
  const fragment = document.createDocumentFragment();
  for (const tab of BASE_TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.view = tab.view;
    if (tab.mode) button.dataset.mode = tab.mode;
    button.textContent = tab.label;
    if (tab.active) {
      button.className = 'active';
      button.setAttribute('aria-current', 'page');
    }
    fragment.append(button);
  }
  tabs.replaceChildren(fragment);
  tabs.classList.add('stationhead-subtabs');
}
