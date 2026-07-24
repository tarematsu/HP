import videoWorker from "../../video/src/entry-core.js";
import { refreshFeedSnapshot } from "../../video/src/feed-snapshot.js";
import { LIVENESS_CRON } from "../../video/src/liveness-schedule.js";
import { refreshCompactedFeedSnapshot } from "../../video/src/source-feed-compacted.js";
import { livenessDoDatabase } from "./liveness_do_db";
import type { Env } from "./sources";
import { readVideoRuntimeActive } from "./video_runtime_activation.js";

export async function runVideoLiveness(
  env: Env,
  storage?: DurableObjectStorage,
): Promise<void> {
  if (!await readVideoRuntimeActive(env)) {
    console.log("video-liveness-skipped-inactive-runtime");
    return;
  }

  const runtimeEnv = storage ? { ...env, DB: livenessDoDatabase(env, storage) } : env;
  const pending: Promise<unknown>[] = [];
  await videoWorker.scheduled(
    { cron: LIVENESS_CRON },
    runtimeEnv,
    {
      waitUntil(promise: Promise<unknown>) {
        pending.push(Promise.resolve(promise));
      },
    },
  );

  if (!pending.length) throw new Error("video liveness did not schedule work");
  const results = await Promise.all(pending);
  if (results.some(result => result === null)) throw new Error("video liveness failed");
  const feedChanged = results.some(result => {
    if (!result || typeof result !== "object") return false;
    const row = result as Record<string, unknown>;
    return Number(row.deadCount ?? 0) > 0 || Number(row.revivedCount ?? 0) > 0;
  });
  if (feedChanged) {
    if (storage) await refreshFeedSnapshot(env);
    else await refreshCompactedFeedSnapshot(env);
  }
}
