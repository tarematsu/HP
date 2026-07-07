import type { Env } from "./sources";

const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;

export async function cleanupDeviceData(env: Env, now = Date.now()): Promise<void> {
  const nowSeconds = Math.floor(now / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM device_metrics WHERE observed_at < ?1").bind(now - 90 * DAY_MS),
    env.DB.prepare(
      `DELETE FROM device_commands
        WHERE (completed_at IS NOT NULL AND completed_at < ?1)
           OR (completed_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?2)`,
    ).bind(now - 30 * DAY_MS, now - 7 * DAY_MS),
    env.DB.prepare("DELETE FROM job_runs WHERE finished_at < ?1").bind(nowSeconds - 30 * DAY_SECONDS),
  ]);
}
