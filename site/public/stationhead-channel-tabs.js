import { dashboardModeTabs } from './dashboard-ui-common.js?v=20261004.1';

const STATIONHEAD_CHANNEL_TABS = [
  { value: 'current', label: '現在' },
  { value: 'history', label: '過去' },
  { value: 'played-tracks', label: '再生履歴' },
  { value: 'likes', label: 'いいね' },
  { value: 'broadcasts', label: 'リスパ' },
];

const ALL_CHANNEL_SECTIONS = STATIONHEAD_CHANNEL_TABS.map(({ value }) => value);
const STATIONHEAD_CHANNEL_PROFILES = {
  buddies: { enabled: ALL_CHANNEL_SECTIONS, paused: [] },
  ohisama: { enabled: ['current', 'history', 'played-tracks', 'likes'], paused: ['broadcasts'] },
  nogizaka: { enabled: ['broadcasts'], paused: ['current', 'history', 'played-tracks', 'likes'] },
};

function dataAttributeName(value) {
  return String(value || 'stationhead-section').replace(/[^a-z0-9-]/gi, '');
}

function datasetKey(attribute) {
  return attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function inferredChannel(dataAttribute) {
  const value = dataAttributeName(dataAttribute);
  if (value.startsWith('hinata-') || value.startsWith('ohisama-')) return 'ohisama';
  if (value.startsWith('nogizaka-')) return 'nogizaka';
  return 'buddies';
}

export function stationheadChannelProfile(channel = 'buddies') {
  return STATIONHEAD_CHANNEL_PROFILES[channel] || STATIONHEAD_CHANNEL_PROFILES.buddies;
}

export function stationheadChannelTabs({
  channel = '',
  dataAttribute = 'stationhead-section',
  ariaLabel = 'Stationhead表示切替',
  active = 'current',
  enabled = null,
  paused = null,
  unavailableTitle = '未提供',
  pausedTitle = '一時停止中',
} = {}) {
  const profile = stationheadChannelProfile(channel || inferredChannel(dataAttribute));
  const enabledSet = new Set(enabled || profile.enabled);
  const pausedSet = new Set(paused || profile.paused);
  return dashboardModeTabs(STATIONHEAD_CHANNEL_TABS.map(({ value, label }) => ({
    value,
    label,
    active: value === active,
    disabled: !enabledSet.has(value),
    title: enabledSet.has(value) ? '' : (pausedSet.has(value) ? pausedTitle : unavailableTitle),
  })), {
    dataAttribute,
    className: 'stationhead-subtabs',
    ariaLabel,
    selection: 'current',
  });
}

export function bindStationheadChannelTabs(root, {
  dataAttribute = 'stationhead-section',
  panelAttribute = 'stationhead-panel',
  initial = 'current',
  onSelect = null,
} = {}) {
  if (!root) return () => {};
  const sectionAttribute = dataAttributeName(dataAttribute);
  const panelDataAttribute = dataAttributeName(panelAttribute);
  const sectionKey = datasetKey(sectionAttribute);
  const panelKey = datasetKey(panelDataAttribute);
  const selector = `[data-${sectionAttribute}]`;
  const panelSelector = `[data-${panelDataAttribute}]`;

  function select(section) {
    const requested = root.querySelector(`${selector}[data-${sectionAttribute}="${CSS.escape(section)}"]`);
    if (!requested || requested.disabled) return;
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
    if (!button.disabled) button.addEventListener('click', () => select(button.dataset[sectionKey] || initial));
  });
  select(initial);
  return select;
}

export { ALL_CHANNEL_SECTIONS, STATIONHEAD_CHANNEL_PROFILES, STATIONHEAD_CHANNEL_TABS };
