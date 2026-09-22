import './history/history-global-fixes.js';
import './pages-ui-tweaks.js?v=20260921.1';
import './dashboard-header.js?v=20260923.4';
import './dashboard-tabs.js?v=20260923.5';
import './dashboard-current-layout.js?v=20260923.4';
import './dashboard-chart-stability.js?v=20260923.4';
import './dashboard-chart-comparison.js?v=20260923.5';
import './dashboard-chart-detail.js?v=20260923.4';
import './dashboard-daily-summaries.js?v=20260923.4';
import './dashboard-fetch-cache.js?v=20260923.4';

const IMAGE_RETRY_DELAYS = [5_000, 30_000, 120_000];
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

void import('/dashboard-client.js?v=20260923.4').catch((error) => {
  console.error('dashboard client failed to start', error);
  const status = document.getElementById('statusMessage');
  if (status) {
    status.textContent = '画面の初期化に失敗しました。再読み込みしてください。';
    status.hidden = false;
  }
});
