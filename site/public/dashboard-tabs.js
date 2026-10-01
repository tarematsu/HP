const HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']);

const REGIONAL_MUSIC_SOURCE_DEFINITIONS = Object.freeze([
  ['genie', 'Genie', 2],
  ['bugs', 'Bugs!', 2],
  ['joox', 'JOOX', 2],
  ['nhaccuatui', 'NhacCuaTui', 2],
  ['anghami', 'Anghami', 2],
  ['melon', 'Melon', 2],
  ['qq_music', 'QQ Music', 2],
  ['netease_cloud_music', 'NetEase Cloud Music', 3],
  ['kugou_music', 'Kugou Music', 3],
  ['naver_vibe', 'Naver VIBE', 3],
  ['flo', 'FLO', 3],
  ['yandex_music', 'Yandex Music', 3],
  ['boomplay', 'Boomplay', 3],
  ['plern', 'Plern', 4],
  ['fungjai', 'Fungjai', 4],
  ['zing_mp3', 'Zing MP3', 4],
  ['jiosaavn', 'JioSaavn', 4],
  ['gaana', 'Gaana', 4],
  ['langit_musik', 'Langit Musik', 4],
]);

const REGIONAL_MUSIC_SOURCES = Object.freeze(REGIONAL_MUSIC_SOURCE_DEFINITIONS.map(([id, label, row]) => Object.freeze({
  id,
  label,
  row,
  defaultMode: id,
  modes: Object.freeze([id]),
})));

const REGIONAL_MUSIC_LAZY_VIEWS = Object.freeze(Object.fromEntries(
  REGIONAL_MUSIC_SOURCE_DEFINITIONS.map(([id, label]) => [id, Object.freeze({
    viewId: 'regionalMusicView',
    shell: () => import('/regional-music-shell.js?v=20261002.1'),
    runtime: () => import('/regional-music.js?v=20261002.1'),
    loadExport: 'loadRegionalMusicView',
    noticeId: 'regionalMusicNotice',
    errorLabel: `regional music ${id}`,
    errorMessage: `${label}データの初期化に失敗しました。再読み込みしてください。`,
  })]),
));

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
    runtime: () => import(location.origin + '/followers.js?v=20260930.3'),
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
  'youtube-music': {
    viewId: 'youtubeMusicView',
    shell: () => import('/youtube-music-shell.js?v=20261002.1'),
    runtime: () => import('/youtube-music.js?v=20261002.1'),
    loadExport: 'loadYoutubeMusicView',
    noticeId: 'youtubeMusicNotice',
    errorLabel: 'youtube music',
    errorMessage: 'YouTube Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  ...REGIONAL_MUSIC_LAZY_VIEWS,
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
      Object.freeze({ id: 'spotify', label: 'Spotify', row: 1, defaultMode: 'spotify', modes: Object.freeze(['spotify']) }),
      Object.freeze({ id: 'apple-music', label: 'Apple Music', row: 1, defaultMode: 'apple-music', modes: Object.freeze(['apple-music']) }),
      Object.freeze({ id: 'amazon-music', label: 'Amazon Music', row: 1, defaultMode: 'amazon-music', modes: Object.freeze(['amazon-music']) }),
      Object.freeze({ id: 'youtube-music', label: 'YouTube Music', row: 1, defaultMode: 'youtube-music', modes: Object.freeze(['youtube-music']) }),
      ...REGIONAL_MUSIC_SOURCES,
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

function buildSourceButton(source, activeSource) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.source = source.id;
  button.textContent = source.label;
  const selected = source.id === activeSource.id;
  button.classList.toggle('active', selected);
  button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  return button;
}

function renderSourceTabs(section, activeSource) {
  if (!sourceTabs) return;
  const fragment = document.createDocumentFragment();
  const multiline = section.sources.some((source) => Number(source.row) > 0);
  sourceTabs.classList.toggle('is-multiline', multiline);

  if (multiline) {
    const rows = new Map();
    for (const source of section.sources) {
      const rowNumber = Math.max(1, Number(source.row) || 1);
      if (!rows.has(rowNumber)) rows.set(rowNumber, []);
      rows.get(rowNumber).push(source);
    }
    for (const [rowNumber, sources] of [...rows.entries()].sort((left, right) => left[0] - right[0])) {
      const rowNode = document.createElement('div');
      rowNode.className = 'dashboard-source-row';
      rowNode.dataset.row = String(rowNumber);
      rowNode.setAttribute('role', 'group');
      rowNode.setAttribute('aria-label', rowNumber === 1 ? '主要サービス' : `地域サービス ${rowNumber - 1}`);
      for (const source of sources) rowNode.append(buildSourceButton(source, activeSource));
      fragment.append(rowNode);
    }
  } else {
    for (const source of section.sources) fragment.append(buildSourceButton(source, activeSource));
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
  history[replace ? 'replaceState' : 'pushState'](null, '', target);
}

function showOnly(view) {
  for (const id of VIEW_IDS) {
    const node = document.getElementById(id);
    if (node) node.hidden = node !== view;
  }
}

function loadOnce(key, importer) {
  if (!modulePromises.has(key)) {
    const promise = importer().catch((error) => {
      modulePromises.delete(key);
      throw error;
    });
    modulePromises.set(key, promise);
  }
  return modulePromises.get(key);
}

function setRoute(mode, view, { updateUrl = true, replaceUrl = false } = {}) {
  activeMode = mode;
  showOnly(view);
  updateTabs(mode);
  if (updateUrl) updateLocation(mode, { replace: replaceUrl });
}

function showCurrent(options = {}) {
  setRoute('current', currentView, options);
  markRouteReady();
}

function showRuntimeError(config, error) {
  console.error(`${config.errorLabel} runtime failed to start`, error);
  const notice = document.getElementById(config.noticeId);
  if (!notice) return;
  notice.textContent = config.errorMessage;
  notice.classList.add('error');
  notice.hidden = false;
}

async function ensureLazyShell(mode) {
  const config = LAZY_VIEWS[mode];
  if (!config?.shell) return;
  await loadOnce(`${mode}:shell`, config.shell);
}

async function showLazyView(mode, options = {}) {
  const config = LAZY_VIEWS[mode];
  if (!config) return;
  setRoute(mode, config.shell ? null : document.getElementById(config.viewId), options);
  if (!config.shell) markRouteReady();

  try {
    await ensureLazyShell(mode);
    if (activeMode !== mode) return;
    if (config.shell) {
      showOnly(document.getElementById(config.viewId));
      markRouteReady();
    }
    const runtime = await loadOnce(`${mode}:runtime`, config.runtime);
    if (activeMode !== mode) return;
    if (config.loadExport) await runtime[config.loadExport]?.(mode);
  } catch (error) {
    if (activeMode !== mode) return;
    markRouteReady();
    showRuntimeError(config, error);
  } finally {
    releaseUnexpectedSkipLinkFocus();
  }
}

async function showHistory(mode, { updateUrl = true, replaceUrl = false, syncRuntime = true } = {}) {
  if (!HISTORY_MODES.has(mode)) {
    showCurrent({ updateUrl, replaceUrl });
    return;
  }

  const runtimeReady = historyRuntimeMode !== null;
  setRoute(mode, runtimeReady ? historyView : null, { updateUrl, replaceUrl });
  if (runtimeReady) markRouteReady();

  try {
    if (mode === 'ranking') {
      await loadOnce('ranking-status', () => import('/history/history-ranking-table-status.js?v=20260923.2'));
      if (activeMode !== mode) return;
    }
    await loadOnce('history-runtime', () => import('/history/history-main.js?v=20261001.1'));
    if (activeMode !== mode) return;
    if (syncRuntime && historyRuntimeMode !== mode) {
      tabs?.querySelector(`button[data-mode="${mode}"]`)?.dispatchEvent(new Event('click'));
    }
    if (activeMode !== mode) return;
    historyRuntimeMode = mode;
    showOnly(historyView);
    markRouteReady();
  } catch (error) {
    if (activeMode !== mode) return;
    historyRuntimeMode = null;
    showOnly(historyView);
    markRouteReady();
    showRuntimeError({
      noticeId: 'notice',
      errorLabel: 'history',
      errorMessage: '過去データの初期化に失敗しました。再読み込みしてください。',
    }, error);
  } finally {
    releaseUnexpectedSkipLinkFocus();
  }
}

function modeFromLocation() {
  const mode = location.hash.slice(1);
  return VIEW_MODES.has(mode) ? mode : 'current';
}

function showMode(mode, options = {}) {
  if (mode === 'current') showCurrent(options);
  else if (HISTORY_MODES.has(mode)) void showHistory(mode, options);
  else void showLazyView(mode, options);
}

function activateMode(mode) {
  const targetMode = String(mode || '');
  if (!VIEW_MODES.has(targetMode)) return;
  const buttonMode = visibleTabMode(targetMode);
  const button = [...(tabs?.querySelectorAll('button') || [])].find((candidate) => routeModeForButton(candidate) === buttonMode);
  if (button && targetMode === buttonMode) button.click();
  else showMode(targetMode);
}

function sourceById(section, sourceId) {
  return section?.sources.find((source) => source.id === sourceId) || section?.sources[0] || null;
}

function syncFromLocation() {
  const mode = modeFromLocation();
  if (mode !== activeMode) showMode(mode, { updateUrl: false });
}

sectionTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-section]');
  if (!button || !sectionTabs.contains(button)) return;
  const section = NAVIGATION.find((item) => item.id === button.dataset.section);
  if (!section) return;
  const source = sourceById(section, lastSourceBySection.get(section.id));
  if (!source) return;
  activateMode(lastModeBySource.get(source.id) || source.defaultMode);
});

sourceTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-source]');
  if (!button || !sourceTabs.contains(button)) return;
  const currentNavigation = navigationForMode(activeMode);
  const source = sourceById(currentNavigation?.section, button.dataset.source);
  if (!source) return;
  activateMode(lastModeBySource.get(source.id) || source.defaultMode);
});

tabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !tabs.contains(button)) return;
  const mode = routeModeForButton(button);
  if (!mode || !VIEW_MODES.has(mode)) return;
  event.preventDefault();
  if (HISTORY_MODES.has(mode)) {
    void showHistory(mode, { syncRuntime: false });
  } else {
    showMode(mode);
  }
}, { capture: true });

if (tabs && sectionTabs && sourceTabs) {
  new MutationObserver(() => {
    const navigation = navigationForMode(activeMode);
    if (navigation) syncModeTabs(navigation.source);
  }).observe(tabs, { childList: true });
}

window.addEventListener('popstate', syncFromLocation);
window.addEventListener('hashchange', syncFromLocation);

void Promise.all([
  ensureLazyShell('amazon-music'),
  ensureLazyShell('apple-music'),
  ensureLazyShell('nogizaka'),
]).catch((error) => {
  console.error('dashboard tab shell failed to start', error);
});

const initialMode = modeFromLocation();
showMode(initialMode, {
  updateUrl: initialMode === 'current' && Boolean(location.hash),
  replaceUrl: true,
  syncRuntime: false,
});
