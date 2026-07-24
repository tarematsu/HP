const FEED_RETENTION_MS = 48 * 60 * 60 * 1000;
const SEEN_SESSION_MS = 6 * 60 * 60 * 1000;

export function isoBefore(reference, milliseconds) {
  const parsed = Date.parse(reference);
  const timestamp = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(timestamp - milliseconds).toISOString();
}

export function seenSessionStart(reference) {
  const parsed = Date.parse(reference);
  const timestamp = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(Math.floor(timestamp / SEEN_SESSION_MS) * SEEN_SESSION_MS).toISOString();
}

export function recentFeedCutoff(capturedAt) {
  return isoBefore(capturedAt, FEED_RETENTION_MS);
}
