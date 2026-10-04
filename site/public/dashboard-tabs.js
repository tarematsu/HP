import { ensureDashboardSectionStyles } from './dashboard-styles.js?v=20261005.2';
const HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'broadcasts']);
const HISTORY_VIEW = {
  viewId: 'historyView',
  shell: () => import('/history-shell.js?v=20260930.1'),
};
const LAZY_VIEWS = {
  hinata: {
    viewId: 'hinataView',
    shell: () => import('/hinata-shell.js?v=20261001.2'),
    runtime: () => import('/hinata.js?v=20260930.5'),
    loadExport: 'loadHinataView',
    noticeId: 'hinataNotice',
    errorLabel: 'hinata',
    errorMessage: '日向坂データの初期化に失敗しました。再読み込みしてください。',
  },
  ranking: {
    viewId: 'leaderboardView',
    shell: () => import('/leaderboard-shell.js?v=20261005.2'),
    runtime: () => import('/leaderboard.js?v=20261005.2'),
    loadExport: 'loadLeaderboardView',
    loadArgs: { source: 'stationhead' },
    noticeId: 'leaderboardNotice',
    errorLabel: 'stationhead leaderboard',
    errorMessage: 'リーダーボードデータの初期化に失敗しました。再読み込みしてください。',
  },
  followers: {
    viewId: 'followersView',
    shell: () => import('/followers-shell.js?v=20261005.2'),
    runtime: () => import('/followers.js?v=20261005.2'),
    loadExport: 'loadFollowersView',
    loadArgs: { source: 'stationhead' },
    noticeId: 'followersNotice',
    errorLabel: 'followers',
    errorMessage: 'フォロワーデータの初期化に失敗しました。再読み込みしてください。',
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
    shell: () => import('/spotify-shell.js?v=20261004.1'),
    runtime: () => import('/spotify.js?v=20261004.1'),
    loadExport: 'loadSpotifyView',
    noticeId: 'spotifyNotice',
    errorLabel: 'spotify',
    errorMessage: 'Spotify再生数の初期化に失敗しました。再読み込みしてください。',
  },
  'amazon-music': {
    viewId: 'amazonMusicView',
    shell: () => import('/amazon-music-shell.js?v=20261004.1'),
    runtime: () => import('/amazon-music.js?v=20261004.1'),
    loadExport: 'loadAmazonMusicView',
    noticeId: 'amazonMusicNotice',
    errorLabel: 'amazon music',
    errorMessage: 'Amazon Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  'apple-music': {
    viewId: 'appleMusicView',
    shell: () => import('/apple-music-shell.js?v=20261004.1'),
    runtime: () => import('/apple-music.js?v=20261001.1'),
    loadExport: 'loadAppleMusicView',
    noticeId: 'appleMusicNotice',
    errorLabel: 'apple music',
    errorMessage: 'Apple Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  'youtube-music': {
    viewId: 'youtubeMusicView',
    shell: () => import('/youtube-music-shell.js?v=20261003.4'),
    runtime: () => import('/youtube-music.js?v=20261004.2'),
    loadExport: 'loadYoutubeMusicView',
    noticeId: 'youtubeMusicNotice',
    errorLabel: 'youtube music',
    errorMessage: 'YouTube Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  kkbox: {
    viewId: 'kkboxView',
    shell: () => import('/kkbox-shell.js?v=20261004.1'),
    runtime: () => import('/kkbox.js?v=20261004.1'),
    loadExport: 'loadKkboxView',
    noticeId: 'kkboxNotice',
    errorLabel: 'kkbox',
    errorMessage: 'KKBOXデータの初期化に失敗しました。再読み込みしてください。',
  },
  qq_music: {
    viewId: 'qqMusicView',
    shell: () => import('/qq-music-shell.js?v=20261004.1'),
    runtime: () => import('/qq-music.js?v=20261004.1'),
    loadExport: 'loadQqMusicView',
    noticeId: 'qqMusicNotice',
    errorLabel: 'qq music',
    errorMessage: 'QQ音乐データの初期化に失敗しました。再読み込みしてください。',
  },
  kugou_music: {
    viewId: 'kugouMusicView',
    shell: () => import('/kugou-music-shell.js?v=20261004.1'),
    runtime: () => import('/kugou-music.js?v=20261004.1'),
    loadExport: 'loadKugouMusicView',
    noticeId: 'kugouMusicNotice',
    errorLabel: 'kugou music',
    errorMessage: '酷狗音乐データの初期化に失敗しました。再読み込みしてください。',
  },
  'music-ranking': {
    viewId: 'leaderboardView',
    shell: () => import('/leaderboard-shell.js?v=20261005.2'),
    runtime: () => import('/leaderboard.js?v=20261005.2'),
    loadExport: 'loadLeaderboardView',
    loadArgs: { source: 'music-streaming' },
    noticeId: 'leaderboardNotice',
    errorLabel: 'music streaming leaderboard',
    errorMessage: '音楽ストリーミングサービスのリーダーボード初期化に失敗しました。再読み込みしてください。',
  },
  'music-followers': {
    viewId: 'followersView',
    shell: () => import('/followers-shell.js?v=20261005.2'),
    runtime: () => import('/followers.js?v=20261005.2'),
    loadExport: 'loadFollowersView',
    loadArgs: { source: 'music-streaming' },
    noticeId: 'followersNotice',
    errorLabel: 'music streaming followers',
    errorMessage: '音楽ストリーミングサービスのフォローデータ初期化に失敗しました。再読み込みしてください。',
  },
  nogizaka: {
    viewId: 'nogizakaListeningPartyView',
    shell: () => import('/nogizaka-listening-party-shell.js?v=20261003.1'),
    runtime: () => import('/nogizaka-listening-party.js?v=20260930.1'),
    loadExport: 'loadNogizakaListeningPartyView',
    noticeId: 'nogizakaListeningPartyNotice',
    errorLabel: 'nogizaka listening party',
    errorMessage: '乃木坂公式リスパデータの初期化に失敗しました。再読み込みしてください。',
  },
  likes: {
    viewId: 'likesView',
    shell: () => import('/likes-shell.js?v=20260930.1'),
    runtime: () => import('/history/history-likes.js?v=20260930.1'),
    noticeId: 'likesNotice',
    errorLabel: 'likes',
    errorMessage: 'いいねデータの初期化に失敗しました。再読み込みしてください。',
  },
};

const NAVIGATION = [
  {
    id: 'stationhead',
    sources: [
      { id: 'buddies', label: 'Buddies', defaultMode: 'current', modes: ['current', 'daily', 'weekly', 'monthly', 'played-tracks', 'likes', 'broadcasts'] },
      { id: 'hinata', label: 'Ohisama', defaultMode: 'hinata', modes: ['hinata'] },
      { id: 'nogizaka', label: 'Nogizaka', defaultMode: 'nogizaka', modes: ['nogizaka'] },
      { id: 'ranking', label: 'リーダーボード', defaultMode: 'ranking', modes: ['ranking'] },
      { id: 'followers', label: 'フォロワー', defaultMode: 'followers', modes: ['followers'] },
    ],
  },
  {
    id: 'subscriptions',
    sources: [
      { id: 'spotify', label: 'Spotify', defaultMode: 'spotify', modes: ['spotify'] },
      { id: 'apple-music', label: 'Apple Music', defaultMode: 'apple-music', modes: ['apple-music'] },
      { id: 'amazon-music', label: 'Amazon Music', defaultMode: 'amazon-music', modes: ['amazon-music'] },
      { id: 'youtube-music', label: 'YouTube Music', defaultMode: 'youtube-music', modes: ['youtube-music'] },
      { id: 'kkbox', label: '🇹🇼KKBOX', defaultMode: 'kkbox', modes: ['kkbox'] },
      { id: 'qq_music', label: '🇨🇳QQ音乐', defaultMode: 'qq_music', modes: ['qq_music'] },
      { id: 'kugou_music', label: '🇨🇳酷狗音乐', defaultMode: 'kugou_music', modes: ['kugou_music'] },
      { id: 'music-ranking', label: 'リーダーボード', defaultMode: 'music-ranking', modes: ['music-ranking'] },
      { id: 'music-followers', label: 'フォロー', defaultMode: 'music-followers', modes: ['music-followers'] },
    ],
  },
];
const MODE_NAVIGATION = new Map();
for (const section of NAVIGATION) {
  for (const source of section.sources) {
    for (const mode of source.modes) MODE_NAVIGATION.set(mode, { section, source });
  }
}
const VIEW_MODES = new Set(['current', ...HISTORY_MODES, ...Object.keys(LAZY_VIEWS)]);
const VIEW_IDS = ['currentView', 'historyView', ...Object.values(LAZY_VIEWS).map(({ viewId }) => viewId)];

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

function navigationForMode(mode) {
  return MODE_NAVIGATION.get(mode) || MODE_NAVIGATION.get('current');
}

function ensureModeStyles(mode) {
  if (mode === 'current') return Promise.resolve();
  return ensureDashboardSectionStyles(navigationForMode(mode)?.section.id);
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
    button.setAttribute('aria-pressed', String(selected));
    fragment.append(button);
  }
  sourceTabs.classList.toggle('is-multiline', section.id === 'subscriptions');
  sourceTabs.replaceChildren(fragment);
  sourceTabs.hidden = false;
  let select = document.getElementById('sourceSelect');
  if (!select) {
    const label = document.createElement('label');
    label.className = 'dashboard-source-picker';
    label.htmlFor = 'sourceSelect';
    label.append('表示対象');
    select = document.createElement('select');
    select.id = 'sourceSelect';
    label.append(select);
    sourceTabs.after(label);
    select.addEventListener('change', () => {
      const source = sourceById(navigationForMode(activeMode)?.section, select.value);
      if (source) activateMode(lastModeBySource.get(source.id) || source.defaultMode);
    });
  }
  select.replaceChildren(...section.sources.map((source) => {
    const option = document.createElement('option');
    option.value = source.id;
    option.textContent = source.label;
    option.selected = source.id === activeSource.id;
    return option;
  }));
}

function syncModeTabs(source) {
  if (!tabs) return;
  tabs.hidden = Boolean(sectionTabs && sourceTabs) && source.id !== 'buddies';
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
    button.setAttribute('aria-pressed', String(selected));
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
  const oldURL = location.href;
  history[replace ? 'replaceState' : 'pushState'](null, '', target);
  if (oldURL !== location.href) window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
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
  document.getElementById('routeError')?.remove();
  showOnly(view);
  updateTabs(mode);
  if (updateUrl) updateLocation(mode, { replace: replaceUrl });
}

async function showCurrent(options = {}) {
  setRoute('current', null, options);
  try {
    await loadOnce('current:shell', () => import('/current-shell.js?v=20261005.2'));
    if (activeMode !== 'current') return;
    showOnly(document.getElementById('currentView'));
    markRouteReady();
    const runtime = await loadOnce('current:runtime', () => import('/stationhead-channel.js?v=20261005.2'));
    if (activeMode === 'current') await runtime.loadStationheadChannelView('currentView');
  } catch (error) {
    if (activeMode !== 'current') return;
    markRouteReady();
    console.error('Stationhead channel runtime failed to start', error);
    const notice = document.querySelector('#currentView [data-role="notice"]');
    if (notice) { notice.textContent = '画面の初期化に失敗しました。再読み込みしてください。'; notice.hidden = false; }
    else showRuntimeError({ errorLabel: 'current', errorMessage: '画面の初期化に失敗しました。再読み込みしてください。' }, error);
  }
}

function showRuntimeError(config, error) {
  console.error(`${config.errorLabel} runtime failed to start`, error);
  const notice = document.getElementById(config.noticeId);
  if (!notice) {
    const error = document.createElement('p');
    error.id = 'routeError';
    error.className = 'notice error';
    error.setAttribute('role', 'alert');
    error.textContent = config.errorMessage;
    document.querySelector('.dashboard-header')?.after(error);
    return;
  }
  notice.textContent = config.errorMessage;
  notice.classList.add('error');
  notice.hidden = false;
}

async function showLazyView(mode, options = {}) {
  const config = LAZY_VIEWS[mode];
  if (!config) return;
  setRoute(mode, null, options);
  try {
    await Promise.all([
      ensureModeStyles(mode),
      loadOnce(`${mode}:shell`, config.shell),
    ]);
    if (activeMode !== mode) return;
    showOnly(document.getElementById(config.viewId));
    markRouteReady();
    const runtime = await loadOnce(`${mode}:runtime`, config.runtime);
    if (activeMode !== mode) return;
    if (config.loadExport) await runtime[config.loadExport]?.(config.loadArgs || undefined);
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
  setRoute(mode, null, { updateUrl, replaceUrl });
  try {
    await Promise.all([
      ensureModeStyles(mode),
      loadOnce('history:shell', HISTORY_VIEW.shell),
    ]);
    if (activeMode !== mode) return;
    if (mode === 'broadcasts') {
      await loadOnce('first-week:shell', () => import('/first-week-comparison-shell.js?v=20261002.2'));
      await loadOnce('first-week:runtime', () => import('/first-week-comparison.js?v=20261002.2'));
      if (activeMode !== mode) return;
    }
    await loadOnce('history:runtime', () => import('/history/history-main.js?v=20261002.4'));
    if (activeMode !== mode) return;
    if (syncRuntime && historyRuntimeMode !== mode) {
      window.dispatchEvent(new CustomEvent('history:select-mode', { detail: { mode } }));
    }
    if (activeMode !== mode) return;
    historyRuntimeMode = mode;
    showOnly(document.getElementById(HISTORY_VIEW.viewId));
    markRouteReady();
  } catch (error) {
    if (activeMode !== mode) return;
    historyRuntimeMode = null;
    showOnly(document.getElementById(HISTORY_VIEW.viewId));
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
  if (mode === 'first-week' || mode === 'unofficial') {
    history.replaceState(null, '', `${location.pathname}${location.search}#broadcasts`);
    return 'broadcasts';
  }
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
  if (source) activateMode(lastModeBySource.get(source.id) || source.defaultMode);
});

sourceTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-source]');
  if (!button || !sourceTabs.contains(button)) return;
  const source = sourceById(navigationForMode(activeMode)?.section, button.dataset.source);
  if (source) activateMode(lastModeBySource.get(source.id) || source.defaultMode);
});

tabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !tabs.contains(button)) return;
  const mode = routeModeForButton(button);
  if (!VIEW_MODES.has(mode)) return;
  event.preventDefault();
  if (HISTORY_MODES.has(mode)) void showHistory(mode, { syncRuntime: false });
  else showMode(mode);
}, { capture: true });

window.addEventListener('popstate', syncFromLocation);
window.addEventListener('hashchange', syncFromLocation);

const initialMode = modeFromLocation();
showMode(initialMode, {
  updateUrl: initialMode === 'current' && Boolean(location.hash),
  replaceUrl: true,
  syncRuntime: false,
});
