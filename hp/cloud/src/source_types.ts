export interface Env {
  BROWSER?: Fetcher;
  DB: D1Database;
  DATA_BUCKET?: R2Bucket;
  STATIONHEAD_LEADERBOARD_REFRESH_QUEUE?: Queue;
  UPDATE_BUCKET?: R2Bucket;
  SCHEDULER_COORDINATOR?: DurableObjectNamespace;
  HOMEPANEL_INGEST_SECRET?: string;
  HOMEPANEL_DEVICE_TOKENS?: string;
  HOMEPANEL_PRIMARY_DEVICE_ID?: string;
  HOMEPANEL_PUBLIC_URL?: string;
  API_TOKEN?: string;
  DEVICE_TOKEN?: string;
  SWITCHBOT_TOKEN?: string;
  SWITCHBOT_SECRET?: string;
  OCTOPUS_EMAIL?: string;
  OCTOPUS_PASSWORD?: string;
  OCTOPUS_ACCOUNT_NUMBER?: string;
  UPDATE_SIGNING_SECRET?: string;
  UPDATE_BUCKET_PREFIX?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  SPOTIFY_REDIRECT_URI?: string;
  SPOTIFY_TOKEN_ENCRYPTION_KEY?: string;
  CITY_NAME?: string;
  WEATHERNEWS_URL?: string;
  STATIONHEAD_MONITOR_URL?: string;
  STATIONHEAD_HEALTH_URL?: string;
  STATIONHEAD_HEALTH_STALE_MS?: string;
  STATIONHEAD_ALERT_TO?: string;
  STATIONHEAD_ALERT_FROM?: string;
  RESEND_API_KEY?: string;
  RADAR_CENTER_LAT?: string;
  RADAR_CENTER_LON?: string;
  RADAR_ZOOM?: string;
  GITHUB_RADAR_DISPATCH_TOKEN?: string;
}

export type StateStatus = "ok" | "stale" | "error";
export interface SourceResult { source: string; payload: unknown; observedAt: number; }
export const JST_MS = 9 * 60 * 60 * 1000;

function twoDigits(value: number): string { return value < 10 ? `0${value}` : String(value); }
export function jstDayKey(timestampMs: number): string {
  const date = new Date(timestampMs + JST_MS);
  return `${date.getUTCFullYear()}-${twoDigits(date.getUTCMonth() + 1)}-${twoDigits(date.getUTCDate())}`;
}
