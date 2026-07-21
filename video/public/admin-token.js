const ADMIN_TOKEN_KEY = 'video-scraper-admin-token';
const ADMIN_TOKEN_COOKIE = 'video_scraper_admin_token';
const COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const TOKEN_CHANGE_EVENT = 'videoscraper:admin-token-change';

function storageGet(key) {
  try {
    return String(localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function cookieGet(name) {
  try {
    const parts = document.cookie.split(';');
    for (const part of parts) {
      const [rawName, ...rest] = part.trim().split('=');
      if (rawName === name) return decodeURIComponent(rest.join('='));
    }
  } catch {}
  return '';
}

function cookieSet(name, value) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Strict; Secure`;
  } catch {}
}

function cookieRemove(name) {
  try {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Strict; Secure`;
  } catch {}
}

function authGate() {
  return document.querySelector('#authGate');
}

function authForm() {
  return document.querySelector('#authForm');
}

function authInput() {
  return document.querySelector('#authTokenInput');
}

function authMessage() {
  return document.querySelector('#authMessage');
}

function player() {
  return document.querySelector('#player');
}

function setAuthMessage(text = '') {
  const target = authMessage();
  if (target) target.textContent = text;
}

export function pauseMediaElements(elements = []) {
  let paused = 0;
  for (const media of elements) {
    try {
      media.pause();
      paused += 1;
    } catch {}
  }
  return paused;
}

function releaseLockedPresentation() {
  const targetPlayer = player();
  if (targetPlayer) pauseMediaElements(targetPlayer.querySelectorAll('video, audio'));

  try {
    globalThis.screen?.orientation?.unlock?.();
  } catch {}

  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => {});
    }
  } catch {}
}

function releasePresentationIfLocked() {
  if (document.body.classList.contains('is-locked')) releaseLockedPresentation();
}

function applyAccessState(unlocked) {
  if (!unlocked) releaseLockedPresentation();

  document.body.classList.toggle('is-authenticated', unlocked);
  document.body.classList.toggle('is-locked', !unlocked);
  document.body.classList.remove('is-auth-pending');

  const gate = authGate();
  if (gate) gate.hidden = unlocked;

  const targetPlayer = player();
  if (targetPlayer) {
    if (unlocked) targetPlayer.removeAttribute('inert');
    else targetPlayer.setAttribute('inert', '');
  }

  document.title = unlocked ? 'VideoPlayer' : '認証';
}

function emitTokenChange() {
  const stored = Boolean(readAdminToken());
  applyAccessState(stored);
  window.dispatchEvent(new CustomEvent(TOKEN_CHANGE_EVENT, {
    detail: { stored }
  }));
}

export function readAdminToken() {
  return storageGet(ADMIN_TOKEN_KEY) || cookieGet(ADMIN_TOKEN_COOKIE);
}

export function clearAdminToken() {
  storageRemove(ADMIN_TOKEN_KEY);
  cookieRemove(ADMIN_TOKEN_COOKIE);
  setAuthMessage('');
  emitTokenChange();
}

function saveAdminToken(token) {
  const value = String(token || '').trim();
  if (!value) return '';
  storageSet(ADMIN_TOKEN_KEY, value);
  cookieSet(ADMIN_TOKEN_COOKIE, value);
  setAuthMessage('');
  emitTokenChange();
  return value;
}

export async function verifyAdminToken(token) {
  const value = String(token || '').trim();
  if (!value) return false;

  const response = await fetch('/api/admin/status/exclusions?limit=1', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      authorization: `Bearer ${value}`
    }
  });

  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return true;
}

export async function requestAdminToken(options = {}) {
  const {
    force = false,
    reason = ''
  } = options;

  const existing = readAdminToken();
  if (!force && existing) {
    emitTokenChange();
    return existing;
  }

  const input = authInput();
  if (input) {
    applyAccessState(false);
    if (reason) setAuthMessage(reason);
    input.focus();
    return '';
  }

  const entered = window.prompt('ADMIN_TOKEN');
  if (entered === null) return '';

  const token = String(entered || '').trim();
  if (!token) {
    clearAdminToken();
    return '';
  }

  try {
    if (await verifyAdminToken(token)) return saveAdminToken(token);
    clearAdminToken();
    return '';
  } catch {
    setAuthMessage('認証サーバーへ接続できません');
    return '';
  }
}

export async function adminFetch(input, init = {}, options = {}) {
  const reason = options.reason || '';
  const token = readAdminToken() || await requestAdminToken({ reason });
  if (!token) throw new Error('ADMIN_TOKEN未設定');

  const headers = new Headers(init.headers || {});
  headers.set('authorization', `Bearer ${token}`);

  let response = await fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers
  });

  if (response.status !== 401 && response.status !== 403) return response;

  clearAdminToken();
  await requestAdminToken({
    force: true,
    reason: '認証してください。'
  });

  const refreshed = readAdminToken();
  if (!refreshed) return response;

  const retryHeaders = new Headers(init.headers || {});
  retryHeaders.set('authorization', `Bearer ${refreshed}`);
  response = await fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers: retryHeaders
  });
  return response;
}

export function initializeAdminTokenButton() {
  const button = document.querySelector('#adminTokenButton');
  if (!button || button.dataset.initialized === 'true') return;
  button.dataset.initialized = 'true';

  const update = () => {
    const stored = Boolean(readAdminToken());
    button.textContent = stored ? '認証済' : '認証';
    button.dataset.tokenState = stored ? 'stored' : 'missing';
    button.setAttribute('aria-pressed', String(stored));
    button.setAttribute('aria-label', stored ? '保存済みADMIN_TOKENを削除' : 'ADMIN_TOKENを登録');
  };

  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('pointerup', (event) => event.stopPropagation());
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (readAdminToken()) {
      if (window.confirm('保存済みADMIN_TOKENを削除しますか？')) clearAdminToken();
      update();
      return;
    }

    await requestAdminToken({
      force: true,
      reason: '認証してください。'
    });
    update();
  });

  window.addEventListener(TOKEN_CHANGE_EVENT, update);
  update();
}

export function initializeAuthGate() {
  if (document.body.dataset.authGateInitialized === 'true') return;
  document.body.dataset.authGateInitialized = 'true';

  const form = authForm();
  const input = authInput();
  const submitButton = document.querySelector('#authSubmitButton');

  document.addEventListener('fullscreenchange', releasePresentationIfLocked);
  globalThis.screen?.orientation?.addEventListener?.('change', releasePresentationIfLocked);

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = String(input?.value || '').trim();
    if (!token) {
      clearAdminToken();
      setAuthMessage('');
      return;
    }

    if (submitButton) submitButton.disabled = true;
    setAuthMessage('確認中');
    try {
      if (await verifyAdminToken(token)) {
        if (input) input.value = '';
        saveAdminToken(token);
        return;
      }
      clearAdminToken();
      setAuthMessage('認証できません');
      input?.focus();
    } catch {
      setAuthMessage('認証サーバーへ接続できません');
      input?.focus();
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  window.addEventListener(TOKEN_CHANGE_EVENT, () => {
    if (!readAdminToken()) input?.focus();
  });

  emitTokenChange();
}

export async function ensureViewerAdminTokenPrompt() {
  initializeAuthGate();
  initializeAdminTokenButton();
  const existing = readAdminToken();
  if (existing) return existing;
  applyAccessState(false);
  authInput()?.focus();
  return '';
}
