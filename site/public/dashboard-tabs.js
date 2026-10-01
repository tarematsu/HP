const HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']);
const LAZY_VIEWS = Object.freeze({
  hinata: {
    viewId: 'hinataView',
    runtime: () => import(location.origin + '/hinata.js?v=20260930.5'),
    loadExport: 'loadHinataView',
    noticeId: 'hinataNotice',
    errorLabel: 'hinata',
    errorMessage: '日向坂データの初期化に失敗しました。再読み込みしてください。',
  },
  followers: {
    viewId: 'followersView',
    runtime: () => import(location.origin + '/followers.js?v=20261001.4'),
    loadExport: 'loadFollowersView',
    noticeId: 'followersNotice',
    errorLabel: 'followers',
    errorMessage: 'フォロワーデータの初期化に失敗しました。再読み込みしてください。',
  },
  'first-week': {
    viewId: 'firstWeekView',
    shell: () => import('/first-week-comparison-shell.js?v=20260929.1'),
    runtime: () => import('/first-week-comparison.js?v=20260929.1'),
    loadExport: 'loadFirstWeekComparisonView',
    noticeId: 'firstWeekNotice',
    errorLabel: 'first-week',
    errorMessage: '初週比較データの初期化に失敗しました。再読み込みしてください。',
  },
  'played-tracks': {
    viewId: 'playedTracksView',
    shell: () => import('/played-tracks-shell.js?v=20260928.1'),
    runtime: () => import('/played-tracks.js?v=20260927.2'),
    noticeId: 'playedTracksNotice',
    errorLabel: 'played tracks',
    errorMessage: '再生履歴データの初期化に失敗しました。再読み込みしてください。',
  },
  spotify: {
    viewId: 'spotifyView',
    shell: () => import('/spotify-shell.js?v=20260929.1'),
    runtime: () => import('/spotify.js?v=20260929.1'),
    loadExport: 'loadSpotifyView',
    noticeId: 'spotifyNotice',
    errorLabel: 'spotify',
    errorMessage: 'Spotify再生数の初期化に失敗しました。再読み込みしてください。',
  },
  'amazon-music': {
    viewId: 'amazonMusicView',
    shell: () => import('/amazon-music-shell.js?v=20261001.2'),
    runtime: () => import('/amazon-music.js?v=20261001.2'),
    loadExport: 'loadAmazonMusicView',
    noticeId: 'amazonMusicNotice',
    errorLabel: 'amazon music',
    errorMessage: 'Amazon Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  'apple-music': {
    viewId: 'appleMusicView',
    shell: () => import('/apple-music-shell.js?v=20261001.1'),
    runtime: () => import(location.origin + '/apple-music.js?v=20261001.1'),
    loadExport: 'loadAppleMusicView',
    noticeId: 'appleMusicNotice',
    errorLabel: 'apple music',
    errorMessage: 'Apple Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  nogizaka: {
    viewId: 'nogizakaListeningPartyView',
    shell: () => import('/nogizaka-listening-party-shell.js?v=20260930.1'),
    runtime: () => import('/nogizaka-listening-party.js?v=20260930.1'),
    loadExport: 'loadNogizakaListeningPartyView',
    noticeId: 'nogizakaListeningPartyNotice',
    errorLabel: 'nogizaka listening party',
    errorMessage: '乃木坂公式リスパデータの初期化に失敗しました。再読み込みしてください。',
  },
  likes: {
    viewId: 'likesView',
    runtime: () => import('/history/history-likes.js?v=20260930.1'),
    noticeId: 'likesNotice',
    errorLabel: 'likes',
    errorMessage: 'いいねデータの初期化に失敗しました。再読み込みしてください。',
  },
});
const VIEW_MODES = new Set(['current', ...HISTORY_MODES, ...Object.keys(LAZY_VIEWS)]);
const VIEW_IDS = ['currentView', 'historyView', ...Object.values(LAZY_VIEWS).map(({ viewId }) => viewId)];

const NAVIGATION = Object.freeze([
  Object.freeze({
    id: 'stationhead',
    sources: Object.freeze([
      Object.freeze({
        id: 'buddies',
        label: 'Buddies',
        defaultMode: 'current',
        modes: Object.freeze(['current', 'daily', 'weekly', 'monthly', 'first-week', 'played-tracks', 'likes', 'broadcasts']),
      }),
      Object.freeze({ id: 'hinata', label: 'Ohisama', defaultMode: 'hinata', modes: Object.freeze(['hinata']) }),
      Object.freeze({ id: 'nogizaka', label: 'Nogizaka', defaultMode: 'nogizaka', modes: Object.freeze(['nogizaka']) }),
      Object.freeze({ id: 'ranking', label: 'リーダーボード', defaultMode: 'ranking', modes: Object.freeze(['ranking']) }),
      Object.freeze({ id: 'followers', label: 'フォロワー', defaultMode: 'followers', modes: Object.freeze(['followers']) }),
    ]),
  }),
  Object.freeze({
    id: 'subscriptions',
    sources: Object.freeze([
      Object.freeze({ id: 'spotify', label: 'Spotify', defaultMode: 'spotify', modes: Object.freeze(['spotify']) }),
      Object.freeze({ id: 'apple-music', label: 'Apple Music', defaultMode: 'apple-music', modes: Object.freeze(['apple-music']) }),
      Object.freeze({ id: 'amazon-music', label: 'Amazon Music', defaultMode: 'amazon-music', modes: Object.freeze(['amazon-music']) }),
    ]),
  }),
]);
const MODE_NAVIGATION = new Map();
for (const section of NAVIGATION) {
  for (const source of section.sources) {
    for (const mode of source.modes) MODE_NAVIGATION.set(mode, { section, source });
  }
}
const BUDDIES_VISIBLE_MODES = new Set(['current', 'daily', 'first-week', 'played-tracks', 'likes', 'broadcasts']);

const currentView = document.getElementById('currentView');
const historyView = document.getElementById('historyView');
const tabs = document.getElementById('modeTabs');
const sectionTabs = document.getElementById('sectionTabs');
const sourceTabs = document.getElementById('sourceTabs');
const skipLink = document.querySelector('.skip-link');
const modulePromises = new Map();
const lastSourceBySection = new Map(NAVIGATION.map((section) => [section.id, section.sources[0]?.id || '']));
const lastModeBySource = new Map();
let historyRuntimeMode = null;
let activeMode = 'current';
let initialRouteReady = false;

for (const section of NAVIGATION) {
  for (const source of section.sources) lastModeBySource.set(source.id, source.defaultMode);
}

function releaseUnexpectedSkipLinkFocus() {
  if (document.activeElement === skipLink) skipLink?.blur();
  document.documentElement.classList.remove('keyboard-navigation');
}

function markRouteReady() {
  if (initialRouteReady) return;
  initialRouteReady = true;
  window.dispatchEvent(new Event('dashboard:route-ready'));
}

function routeModeForButton(button) {
  return button?.dataset.mode || button?.dataset.view || '';
}

function visibleTabMode(mode) {
  return mode === 'weekly' || mode === 'monthly' ? 'daily' : mode;
}

function navigationForMode(mode) {
  return MODE_NAVIGATION.get(mode) || MODE_NAVIGATION.get('current');
}

function renderSourceTabs(section, activeSource) {
  if (!sourceTabs) return;
  const fragment = document.createDocumentFragment();
  for (const source of section.sources) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.source = source.id;
    button.textContent = source.label;
    const selected = source.id === activeSource.id;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    fragment.append(button);
  }
  sourceTabs.replaceChildren(fragment);
  sourceTabs.hidden = section.sources.length === 0;
}

function syncModeTabs(source) {
  if (!tabs) return;
  if (!sectionTabs || !sourceTabs) {
    tabs.hidden = false;
    return;
  }

  const showBuddiesModes = source.id === 'buddies';
  tabs.hidden = !showBuddiesModes;
  tabs.querySelectorAll('button').forEach((button) => {
    const visible = showBuddiesModes && BUDDIES_VISIBLE_MODES.has(routeModeForButton(button));
    button.hidden = !visible;
    if (!visible) button.removeAttribute('aria-current');
  });
}

function syncNavigation(mode) {
  if (!sectionTabs || !sourceTabs) return;
  const navigation = navigationForMode(mode);
  if (!navigation) return;
  const { section, source } = navigation;
  lastSourceBySection.set(section.id, source.id);
  lastModeBySource.set(source.id, mode);

  sectionTabs.querySelectorAll('button[data-section]').forEach((button) => {
    const selected = button.dataset.section === section.id;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  renderSourceTabs(section, source);
  syncModeTabs(source);
}

function updateTabs(mode) {
  const selectedMode = visibleTabMode(mode);
  tabs?.querySelectorAll('button').forEach((button) => {
    const selected = routeModeForButton(button) === selectedMode;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  syncNavigation(mode);
}

function updateLocation(mode, { replace = false } = {}) {
  const target = mode === 'current' ? '/' : `/#${mode}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (current === target) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ mode }, '', target);
}

async function loadLazyView(mode) {
  const config = LAZY_VIEWS[mode];
  if (!config) return;
  let promise = modulePromises.get(mode);
  if (!promise) {
    promise = (async () => {
      if (config.shell) await config.shell();
      const runtime = await config.runtime();
      if (config.loadExport && typeof runtime[config.loadExport] === 'function') await runtime[config.loadExport]();
      return runtime;
    })();
    modulePromises.set(mode, promise);
  }
  try {
    await promise;
  } catch (error) {
    modulePromises.delete(mode);
    console.error(`failed to load ${config.errorLabel}`, error);
    const notice = config.noticeId ? document.getElementById(config.noticeId) : null;
    if (notice) {
      notice.textContent = config.errorMessage;
      notice.classList.add('error');
    }
    throw error;
  }
}

function setVisibleView(mode) {
  for (const id of VIEW_IDS) {
    const view = document.getElementById(id);
    if (!view) continue;
    const visible = id === 'currentView'
      ? mode === 'current'
      : id === 'historyView'
        ? HISTORY_MODES.has(mode)
        : Object.values(LAZY_VIEWS).some((config) => config.viewId === id && LAZY_VIEWS[mode] === config);
    view.hidden = !visible;
  }
}

async function showView(mode, options = {}) {
  const nextMode = VIEW_MODES.has(mode) ? mode : 'current';
  activeMode = nextMode;
  releaseUnexpectedSkipLinkFocus();
  setVisibleView(nextMode);
  updateTabs(nextMode);
  if (!options.skipLocation) updateLocation(nextMode, { replace: options.replaceLocation });

  try {
    if (HISTORY_MODES.has(nextMode)) {
      if (typeof window.ensureHistoryLoaded === 'function') {
        await window.ensureHistoryLoaded();
        if (historyRuntimeMode !== nextMode && typeof window.renderHistory === 'function') {
          historyRuntimeMode = nextMode;
          await window.renderHistory(nextMode);
        }
      }
    } else if (LAZY_VIEWS[nextMode]) {
      await loadLazyView(nextMode);
    }
  } finally {
    markRouteReady();
  }
}

function modeFromLocation() {
  const hash = location.hash.replace(/^#/, '');
  return VIEW_MODES.has(hash) ? hash : 'current';
}

sectionTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-section]');
  if (!button) return;
  const section = NAVIGATION.find((item) => item.id === button.dataset.section);
  if (!section) return;
  const sourceId = lastSourceBySection.get(section.id) || section.sources[0]?.id;
  const source = section.sources.find((item) => item.id === sourceId) || section.sources[0];
  if (!source) return;
  void showView(lastModeBySource.get(source.id) || source.defaultMode);
});

sourceTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-source]');
  if (!button) return;
  const navigation = navigationForMode(activeMode);
  const section = navigation?.section;
  const source = section?.sources.find((item) => item.id === button.dataset.source);
  if (!source) return;
  void showView(lastModeBySource.get(source.id) || source.defaultMode);
});

tabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.hidden) return;
  const mode = routeModeForButton(button);
  if (VIEW_MODES.has(mode)) void showView(mode);
});

window.addEventListener('popstate', () => {
  void showView(modeFromLocation(), { skipLocation: true });
});

void showView(modeFromLocation(), { skipLocation: true });
