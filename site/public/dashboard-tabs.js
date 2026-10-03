const HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']);
const REGIONAL_MUSIC_MODES = new Set('genie bugs joox nhaccuatui anghami melon kkbox qq_music netease_cloud_music kugou_music naver_vibe flo yandex_music boomplay plern fungjai zing_mp3 jiosaavn gaana langit_musik'.split(' '));
const REGIONAL_MUSIC_VIEW = Object.freeze({
  viewId: 'regionalMusicView',
  shell: () => import('/regional-music-shell.js?v=20261003.2'),
  runtime: () => import('/regional-music.js?v=20261003.3'),
  noticeId: 'regionalMusicNotice',
});

const LAZY_VIEWS = Object.freeze({
  hinata: {
    viewId: 'hinataView',
    runtime: () => import('/hinata.js?v=20260930.5'),
    loadExport: 'loadHinataView',
    noticeId: 'hinataNotice',
    errorLabel: 'hinata',
    errorMessage: '日向坂データの初期化に失敗しました。再読み込みしてください。',
  },
  followers: {
    viewId: 'followersView',
    runtime: () => import('/followers.js?v=20260930.3'),
    loadExport: 'loadFollowersView',
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
    shell: () => import('/spotify-shell.js?v=20260929.1'),
    runtime: () => import('/spotify.js?v=20260929.1'),
    loadExport: 'loadSpotifyView',
    noticeId: 'spotifyNotice',
    errorLabel: 'spotify',
    errorMessage: 'Spotify再生数の初期化に失敗しました。再読み込みしてください。',
  },
  'amazon-music': {
    viewId: 'amazonMusicView',
    shell: () => import('/amazon-music-shell.js?v=20261002.3'),
    runtime: () => import('/amazon-music.js?v=20261002.3'),
    loadExport: 'loadAmazonMusicView',
    noticeId: 'amazonMusicNotice',
    errorLabel: 'amazon music',
    errorMessage: 'Amazon Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  'apple-music': {
    viewId: 'appleMusicView',
    shell: () => import('/apple-music-shell.js?v=20261001.1'),
    runtime: () => import('/apple-music.js?v=20261001.1'),
    loadExport: 'loadAppleMusicView',
    noticeId: 'appleMusicNotice',
    errorLabel: 'apple music',
    errorMessage: 'Apple Musicデータの初期化に失敗しました。再読み込みしてください。',
  },
  'youtube-music': {
    viewId: 'youtubeMusicView',
    shell: () => import('/youtube-music-shell.js?v=20261003.4'),
    runtime: () => import('/youtube-music.js?v=20261003.4'),
    loadExport: 'loadYoutubeMusicView',
    noticeId: 'youtubeMusicNotice',
    errorLabel: 'youtube music',
    errorMessage: 'YouTube Musicデータの初期化に失敗しました。再読み込みしてください。',
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
    runtime: () => import('/history/history-likes.js?v=20260930.1'),
    noticeId: 'likesNotice',
    errorLabel: 'likes',
    errorMessage: 'いいねデータの初期化に失敗しました。再読み込みしてください。',
  },
});
const VIEW_MODES = new Set(['current', ...HISTORY_MODES, ...Object.keys(LAZY_VIEWS), ...REGIONAL_MUSIC_MODES]);
const VIEW_IDS = ['currentView', 'historyView', ...Object.values(LAZY_VIEWS).map(({ viewId }) => viewId), REGIONAL_MUSIC_VIEW.viewId];

const NAVIGATION = Object.freeze([
  Object.freeze({
    id: 'stationhead',
    sources: Object.freeze([
      Object.freeze({
        id: 'buddies',
        label: 'Buddies',
        defaultMode: 'current',
        modes: Object.freeze(['current', 'daily', 'weekly', 'monthly', 'played-tracks', 'likes', 'broadcasts']),
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
      Object.freeze({ id: 'youtube-music', label: 'YouTube Music', defaultMode: 'youtube-music', modes: Object.freeze(['youtube-music']) }),
    ]),
  }),
]);
const MODE_NAVIGATION = new Map();
for (const section of NAVIGATION) {
  for (const source of section.sources) {
    for (const mode of source.modes) MODE_NAVIGATION.set(mode, { section, source });
  }
}
const SUBSCRIPTIONS = NAVIGATION.find(({ id }) => id === 'subscriptions');
const BUDDIES_VISIBLE_MODES = new Set(['current', 'daily', 'played-tracks', 'likes', 'broadcasts']);

const currentView = document.getElementById('currentView');
const historyView = document.getElementById('historyView');
const tabs = document.getElementById('modeTabs');
const sectionTabs = document.getElementById('sectionTabs');
const sourceTabs = document.getElementById('sourceTabs');
const historyPrev = document.getElementById('historyPrev');
const historyNext = document.getElementById('historyNext');
const historyWindow = document.getElementById('historyWindow');
const historyRange = document.getElementById('historyRange');
const historySummary = document.getElementById('historySummary');

function currentNavigation(mode) {
  return MODE_NAVIGATION.get(mode) || MODE_NAVIGATION.get('current');
}

function syncNavigation(mode) {
  const { section, source } = currentNavigation(mode);
  for (const button of sectionTabs?.querySelectorAll('button[data-section]') || []) {
    button.classList.toggle('active', button.dataset.section === section.id);
  }
  for (const button of sourceTabs?.querySelectorAll('button[data-source]') || []) {
    button.classList.toggle('active', button.dataset.source === source.id);
    button.hidden = !section.sources.some((item) => item.id === button.dataset.source);
  }
}

function viewForMode(mode) {
  if (HISTORY_MODES.has(mode)) return historyView;
  const lazy = LAZY_VIEWS[mode];
  if (lazy) return document.getElementById(lazy.viewId);
  if (REGIONAL_MUSIC_MODES.has(mode)) return document.getElementById(REGIONAL_MUSIC_VIEW.viewId);
  return currentView;
}

async function ensureView(mode) {
  const lazy = LAZY_VIEWS[mode];
  if (lazy?.shell && !document.getElementById(lazy.viewId)) await lazy.shell();
  if (REGIONAL_MUSIC_MODES.has(mode) && !document.getElementById(REGIONAL_MUSIC_VIEW.viewId)) await REGIONAL_MUSIC_VIEW.shell();
}

async function loadView(mode) {
  const lazy = LAZY_VIEWS[mode];
  if (lazy) {
    const runtime = await lazy.runtime();
    const load = lazy.loadExport ? runtime[lazy.loadExport] : runtime.default;
    if (typeof load === 'function') await load();
    return;
  }
  if (REGIONAL_MUSIC_MODES.has(mode)) {
    const runtime = await REGIONAL_MUSIC_VIEW.runtime();
    if (typeof runtime.loadRegionalMusicView === 'function') await runtime.loadRegionalMusicView(mode);
  }
}

function setHistoryControlsVisible(mode) {
  const visible = HISTORY_MODES.has(mode);
  if (historyPrev) historyPrev.hidden = !visible;
  if (historyNext) historyNext.hidden = !visible;
  if (historyWindow) historyWindow.hidden = !visible;
  if (historyRange) historyRange.hidden = !visible;
  if (historySummary) historySummary.hidden = !visible;
}

async function setMode(mode, options = {}) {
  if (!VIEW_MODES.has(mode)) mode = 'current';
  await ensureView(mode);
  syncNavigation(mode);
  setHistoryControlsVisible(mode);

  for (const id of VIEW_IDS) {
    const view = document.getElementById(id);
    if (view) view.hidden = view !== viewForMode(mode);
  }
  for (const button of tabs?.querySelectorAll('button[data-mode]') || []) {
    button.classList.toggle('active', button.dataset.mode === mode);
  }

  try {
    await loadView(mode);
  } catch (error) {
    const definition = LAZY_VIEWS[mode];
    console.error(`${definition?.errorLabel || mode} view failed`, error);
    const notice = document.getElementById(definition?.noticeId || REGIONAL_MUSIC_VIEW.noticeId);
    if (notice) {
      notice.textContent = definition?.errorMessage || 'データの初期化に失敗しました。再読み込みしてください。';
      notice.classList.add('error');
    }
  }

  if (options.push !== false) {
    const url = new URL(location.href);
    url.searchParams.set('view', mode);
    history.pushState({ mode }, '', url);
  }
}

function modeForSource(sourceId) {
  for (const section of NAVIGATION) {
    const source = section.sources.find((item) => item.id === sourceId);
    if (source) return source.defaultMode;
  }
  return null;
}

function renderSectionTabs() {
  if (!sectionTabs) return;
  sectionTabs.replaceChildren();
  for (const section of NAVIGATION) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.section = section.id;
    button.textContent = section.id === 'stationhead' ? 'Stationhead' : '音楽サブスク';
    button.addEventListener('click', () => {
      const current = currentNavigation(new URL(location.href).searchParams.get('view'));
      const source = section.sources.find((item) => item.id === current.source.id) || section.sources[0];
      setMode(source.defaultMode);
    });
    sectionTabs.append(button);
  }
}

function renderSourceTabs() {
  if (!sourceTabs) return;
  sourceTabs.replaceChildren();
  for (const source of SUBSCRIPTIONS.sources) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.source = source.id;
    button.textContent = source.label;
    button.addEventListener('click', () => setMode(source.defaultMode));
    sourceTabs.append(button);
  }
  for (const section of NAVIGATION) {
    if (section.id === 'subscriptions') continue;
    for (const source of section.sources) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.source = source.id;
      button.textContent = source.label;
      button.addEventListener('click', () => setMode(source.defaultMode));
      sourceTabs.append(button);
    }
  }
}

function bindModeTabs() {
  for (const button of tabs?.querySelectorAll('button[data-mode]') || []) {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  }
}

window.addEventListener('popstate', () => {
  const mode = new URL(location.href).searchParams.get('view') || 'current';
  setMode(mode, { push: false });
});

renderSectionTabs();
renderSourceTabs();
bindModeTabs();

const initialMode = new URL(location.href).searchParams.get('view') || 'current';
setMode(initialMode, { push: false });
