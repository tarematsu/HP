const STATIONHEAD_CHANNEL_TABS = Object.freeze([
  Object.freeze({ value: 'current', label: '現在' }),
  Object.freeze({ value: 'history', label: '過去' }),
  Object.freeze({ value: 'played-tracks', label: '再生履歴' }),
  Object.freeze({ value: 'likes', label: 'いいね' }),
  Object.freeze({ value: 'broadcasts', label: 'リスパ' }),
]);

function dataAttributeName(value) {
  return String(value || 'stationhead-section').replace(/[^a-z0-9-]/gi, '');
}

export function stationheadChannelTabs({
  dataAttribute = 'stationhead-section',
  ariaLabel = 'Stationhead表示切替',
  active = 'current',
  enabled = STATIONHEAD_CHANNEL_TABS.map(({ value }) => value),
  unavailableTitle = '未提供',
} = {}) {
  const attribute = dataAttributeName(dataAttribute);
  const enabledSet = new Set(enabled);
  const buttons = STATIONHEAD_CHANNEL_TABS.map(({ value, label }) => {
    const isActive = value === active;
    const isEnabled = enabledSet.has(value);
    return `<button type="button" data-${attribute}="${value}"${isActive ? ' class="active" aria-current="page"' : ''}${isEnabled ? '' : ` disabled aria-disabled="true" title="${unavailableTitle}"`}>${label}</button>`;
  }).join('');
  return `<div class="mode-tabs stationhead-subtabs" aria-label="${ariaLabel}">${buttons}</div>`;
}

export function bindStationheadChannelTabs(root, {
  dataAttribute = 'stationhead-section',
  panelAttribute = 'stationhead-panel',
  initial = 'current',
  onSelect = null,
} = {}) {
  if (!root) return () => {};
  const sectionKey = dataAttributeName(dataAttribute).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const panelKey = dataAttributeName(panelAttribute).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const selector = `[data-${dataAttributeName(dataAttribute)}]`;
  const panelSelector = `[data-${dataAttributeName(panelAttribute)}]`;

  function select(section) {
    root.querySelectorAll(selector).forEach((button) => {
      const active = button.dataset[sectionKey] === section;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    root.querySelectorAll(panelSelector).forEach((panel) => {
      panel.hidden = panel.dataset[panelKey] !== section;
    });
    onSelect?.(section);
  }

  root.querySelectorAll(selector).forEach((button) => {
    if (button.disabled) return;
    button.addEventListener('click', () => select(button.dataset[sectionKey] || initial));
  });
  select(initial);
  return select;
}

export { STATIONHEAD_CHANNEL_TABS };
