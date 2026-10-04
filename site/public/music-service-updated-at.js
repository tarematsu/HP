import { loadDashboardJson } from './dashboard-data-client.js?v=20261005.2';
import { musicDateTimeText } from './music-service-runtime-common.js?v=20261004.1';


function latestAppleObservedAt(payload) {
  const values = [payload?.observed_at, ...(Array.isArray(payload?.artists)
    ? payload.artists.map((artist) => artist?.observed_at)
    : [])]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : null;
}

async function installUpdatedAt({ elementId, url, resolve }) {
  const element = document.getElementById(elementId);
  if (!element) return;
  try {
    const payload = await loadDashboardJson(url);
    element.textContent = musicDateTimeText(resolve(payload));
  } catch {
    element.textContent = '-';
  }
}

export function installAppleMusicUpdatedAt() {
  void installUpdatedAt({
    elementId: 'appleUpdatedAt',
    url: '/api/apple-music',
    resolve: latestAppleObservedAt,
  });
}

export function installAmazonMusicUpdatedAt() {
  void installUpdatedAt({
    elementId: 'amazonUpdatedAt',
    url: '/api/amazon-music',
    resolve: (payload) => payload?.observed_at,
  });
}
