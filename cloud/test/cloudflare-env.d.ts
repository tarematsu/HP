export {};

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      CITY_NAME: string;
      WEATHERNEWS_URL: string;
      STATIONHEAD_MONITOR_URL: string;
      HOMEPANEL_INGEST_SECRET: string;
      API_TOKEN: string;
      DEVICE_TOKEN: string;
      SWITCHBOT_TOKEN: string;
      SWITCHBOT_SECRET: string;
      SWITCHBOT_CONTROL_PLUG_IDS: string;
      SWITCHBOT_EXIT_CONFIRM_SECONDS: string;
      SWITCHBOT_FALLBACK_POLL_SECONDS: string;
    }
  }
}
