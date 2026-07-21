import videoWorker from "../../video/src/entry-core.js";
import { LIVENESS_CRON } from "../../video/src/liveness-schedule.js";
import type { Env } from "./sources";
import { videoRuntimeActive } from "./video_runtime_activation.js";

export async function runVideoLiveness(env: Env): Promise<void> {
  if (!await videoRuntimeActive(env)) {
    console.log("video-liveness-skipped-inactive-runtime");
    return;
  }

  const pending: Promise<unknown>[] = [];
  await videoWorker.scheduled(
    { cron: LIVENESS_CRON },
    env,
    {
      waitUntil(promise: Promise<unknown>) {
        pending.push(Promise.resolve(promise));
      },
    },
  );

  if (!pending.length) throw new Error("video liveness did not schedule work");
  const results = await Promise.all(pending);
  if (results.some(result => result === null)) throw new Error("video liveness failed");
}
