import videoWorker from "../../video/src/entry-core.js";
import { refreshFeedSnapshot } from "../../video/src/feed-snapshot.js";
import { LIVENESS_CRON } from "../../video/src/liveness-schedule.js";
import { refreshCompactedFeedSnapshot } from "../../video/src/source-feed-compacted.js";
import { livenessDoDatabase } from "./liveness_do_db";
import type { Env } from "./sources";
import { readVideoRuntimeActive } from "./video_runtime_activation.js";

export const LIVENESS_FEED_SNAPSHOT_PENDING_KEY =
  "video-liveness-feed-snapshot-refresh-pending-v1";

export async function refreshLivenessFeedSnapshotWithRetry(
  storage: DurableObjectStorage,
  feedChanged: boolean,
  refresh: () => Promise<unknown>,
): Promise<boolean> {
  const pending = feedChanged
    || await storage.get<boolean>(LIVENESS_FEED_SNAPSHOT_PENDING_KEY) === true;
  if (!pending) return false;

  // Record the repair obligation before touching R2. Liveness mutations and the
  // cursor have already committed at this point, so a failed snapshot publish
  // must survive the current alarm and be retried even if the next batch has no
  // dead/revived transition of its own.
  await storage.put(LIVENESS_FEED_SNAPSHOT_PENDING_KEY, true);
  await refresh();
  await storage.delete(LIVENESS_FEED_SNAPSHOT_PENDING_KEY);
  return true;
}

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

  if (storage) {
    await refreshLivenessFeedSnapshotWithRetry(
      storage,
      feedChanged,
      () => refreshFeedSnapshot(env),
    );
  } else if (feedChanged) {
    await refreshCompactedFeedSnapshot(env);
  }
}
