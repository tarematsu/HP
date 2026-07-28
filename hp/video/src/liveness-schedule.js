export const LIVENESS_JOB_NAME = 'video_liveness';
export const LIVENESS_INTERVAL_SECONDS = 60 * 60;
export const LIVENESS_SCHEDULE = `homepanel-alarm:${LIVENESS_INTERVAL_SECONDS}s`;

// The Cloudflare Cron invocation is only a low-CPU dispatcher. The bounded
// liveness scan executes inside VideoFeedCoordinator as a Durable Object call.
export const LIVENESS_CRON = '0 * * * *';
