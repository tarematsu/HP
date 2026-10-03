const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function formatDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormat.format(date);
}

async function loadJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'default' });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload;
}

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
    const payload = await loadJson(url);
    element.textContent = formatDateTime(resolve(payload));
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
