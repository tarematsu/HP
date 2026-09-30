import './dashboard-tab-registry.js?v=20260930.1';
import './current-shell.js?v=20260930.1';
import './history-shell.js?v=20260930.1';
import './likes-shell.js?v=20260930.1';
import './legacy-listening-party-route.js?v=20260926.1';
import './dashboard-header.js?v=20260928.1';
import './dashboard-tab-order.js?v=20260929.1';
import './dashboard-hinata-route.js?v=20260930.1';
import './dashboard-followers-route.js?v=20260930.2';
import './dashboard-tabs.js?v=20260930.1';

const IMAGE_RETRY_DELAYS = [5_000, 30_000, 120_000];
const imageRetryTimers = new WeakMap();
let currentRuntimePromise = null;

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

function showCurrentRuntimeError(error) {
  console.error('dashboard client failed to start', error);
  const status = document.getElementById('statusMessage');
  if (status) {
    status.textContent = '画面の初期化に失敗しました。再読み込みしてください。';
    status.hidden = false;
  }
}

function ensureCurrentRuntime() {
  if (currentRuntimePromise) return currentRuntimePromise;
  currentRuntimePromise = (async () => {
    await Promise.all([
      import('./dashboard-current-layout.js?v=20260924.1'),
      import('./dashboard-chart-stability.js?v=20260930.2'),
      import('./dashboard-chart-comparison.js?v=20260930.2'),
      import('./dashboard-chart-detail.js?v=20260930.2'),
      import('./dashboard-daily-summaries.js?v=20260930.2'),
    ]);
    await import('./dashboard-fetch-cache.js?v=20260930.1');
    await import('/dashboard-client.js?v=20260930.2');
  })().catch((error) => {
    currentRuntimePromise = null;
    showCurrentRuntimeError(error);
    throw error;
  });
  return currentRuntimePromise;
}

function locationIsCurrent() {
  const mode = location.hash.slice(1);
  return !mode || mode === 'current';
}

function startCurrentRuntimeFromLocation() {
  if (locationIsCurrent()) void ensureCurrentRuntime();
}

installImageState('channelImage');
installImageState('trackImage');
startCurrentRuntimeFromLocation();

document.getElementById('modeTabs')?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button?.dataset.view === 'current') void ensureCurrentRuntime();
}, { capture: true });
window.addEventListener('popstate', startCurrentRuntimeFromLocation);
window.addEventListener('hashchange', startCurrentRuntimeFromLocation);
