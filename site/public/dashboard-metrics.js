import './dashboard-header.js?v=20260828.1';
import './dashboard-tabs.js?v=20260828.1';
import { renderDashboardDailySummaries } from './dashboard-daily-summaries.js?v=20260828.1';

const DASHBOARD_CACHE_KEY = 'sh.dashboard.v3';
const IMAGE_RETRY_DELAYS = [5_000, 30_000, 120_000];
const nativeFetch = window.fetch.bind(window);
const imageRetryTimers = new WeakMap();

function clearImageRetry(image) {
  const timer = imageRetryTimers.get(image);
  if (timer) clearTimeout(timer);
  imageRetryTimers.delete(image);
}

function canonicalImageSource(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    return new URL(source, location.href).href;
  } catch {
    return source;
  }
}

function installImageState(id) {
  const image = document.getElementById(id);
  if (!image) return;
  const loaded = () => {
    clearImageRetry(image);
    image.dataset.retryAttempt = '0';
    image.classList.add('is-loaded');
    image.hidden = false;
  };
  const failed = () => {
    image.classList.remove('is-loaded');
    image.hidden = true;
    const source = canonicalImageSource(image.currentSrc || image.getAttribute('src') || image.src);
    const attempt = Math.max(0, Number(image.dataset.retryAttempt) || 0);
    if (!source || attempt >= IMAGE_RETRY_DELAYS.length) return;
    image.dataset.retryAttempt = String(attempt + 1);
    clearImageRetry(image);
    const timer = setTimeout(() => {
      imageRetryTimers.delete(image);
      if (!image.hidden || canonicalImageSource(image.currentSrc || image.getAttribute('src') || image.src) !== source) return;
      image.removeAttribute('src');
      requestAnimationFrame(() => { image.src = source; });
    }, IMAGE_RETRY_DELAYS[attempt]);
    imageRetryTimers.set(image, timer);
  };
  image.addEventListener('load', loaded);
  image.addEventListener('error', failed);
  new MutationObserver(() => {
    image.classList.remove('is-loaded');
    const source = canonicalImageSource(image.getAttribute('src'));
    if (!source) {
      image.hidden = true;
      return;
    }
    if (source !== image.dataset.lastSource) {
      clearImageRetry(image);
      image.dataset.lastSource = source;
      image.dataset.retryAttempt = '0';
    }
  }).observe(image, { attributes: true, attributeFilter: ['src'] });
  if (image.complete && image.naturalWidth > 0) loaded();
}

installImageState('channelImage');
installImageState('trackImage');

function requestUrl(input) {
  if (typeof input === 'string' || input instanceof URL) return String(input);
  return input?.url || '';
}

function renderPayload(payload) {
  if (!payload?.ok) return;
  renderDashboardDailySummaries(payload.daily_summaries);
  const status = document.getElementById('statusMessage');
  if (status) {
    status.textContent = '';
    status.hidden = true;
  }
}

function restoreDashboardCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(DASHBOARD_CACHE_KEY) || 'null');
    if (!cached || Date.now() - Number(cached.savedAt || 0) > 6 * 60 * 60_000) return;
    renderPayload(cached.payload);
  } catch {
    localStorage.removeItem(DASHBOARD_CACHE_KEY);
  }
}

async function captureDashboard(input, response) {
  if (!response.ok) return;
  const url = requestUrl(input);
  if (!url || new URL(url, location.href).pathname !== '/api/dashboard') return;
  try {
    renderPayload(await response.clone().json());
  } catch {
    // The dashboard client owns request error reporting.
  }
}

window.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  void captureDashboard(input, response);
  return response;
};

restoreDashboardCache();
void import('/dashboard-client.js?v=20260828.1').catch((error) => {
  console.error('dashboard client failed to start', error);
  const status = document.getElementById('statusMessage');
  if (status) {
    status.textContent = '画面の初期化に失敗しました。再読み込みしてください。';
    status.hidden = false;
  }
});
