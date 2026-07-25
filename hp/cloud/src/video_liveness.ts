import videoWorker from "../../video/src/entry-core.js";
import { refreshFeedSnapshot } from "../../video/src/feed-snapshot.js";
import { LIVENESS_CRON } from "../../video/src/liveness-schedule.js";
import { refreshCompactedFeedSnapshot } from "../../video/src/source-feed-compacted.js";
import { livenessDoDatabase } from "./liveness_do_db";
import type { Env } from "./sources";
import { readVideoRuntimeActive } from "./video_runtime_activation.js";

export const LIVENESS_FEED_SNAPSHOT_PENDING_KEY =
  "video-liveness-feed-snapshot-refresh-pending-v1";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizedError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error === null || error === undefined || error === "") {
    return new Error("video liveness failed");
  }
  return new Error(errorMessage(error));
}

function livenessResultFailure(value: unknown): Error | null {
  if (value === null) return new Error("video liveness failed");
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (result.skipped === true && result.reason === "state-unavailable") {
    return new Error("video liveness state row unavailable");
  }
  return null;
}

async function persistSnapshotRepairMarker(
  storage: DurableObjectStorage,
): Promise<boolean> {
  try {
    await storage.put(LIVENESS_FEED_SNAPSHOT_PENDING_KEY, true);
    return true;
  } catch (error) {
    console.error("video-liveness-feed-repair-marker-write-failed", errorMessage(error));
    return false;
  }
}

export async function collectLivenessResults(
  storage: DurableObjectStorage | undefined,
  pending: readonly Promise<unknown>[],
): Promise<unknown[]> {
  const settled = await Promise.allSettled(pending);
  const fulfilled: unknown[] = [];
  let rejectionError: Error | null = null;
  let rejectionWasError = false;
  let resultFailure: Error | null = null;
  for (const result of settled) {
    if (result.status === "rejected") {
      const candidateWasError = result.reason instanceof Error;
      if (!rejectionError || (candidateWasError && !rejectionWasError)) {
        rejectionError = normalizedError(result.reason);
        rejectionWasError = candidateWasError;
      }
      continue;
    }
    fulfilled.push(result.value);
    if (!resultFailure) resultFailure = livenessResultFailure(result.value);
  }
  if (!rejectionError && !resultFailure) return fulfilled;

  // A failure can happen after D1 mutations commit but before the liveness
  // runtime state/result is returned. Wait for every scheduled task to settle
  // before repairing so a slower sibling cannot mutate the feed after the R2
  // snapshot has already been regenerated.
  if (storage) await persistSnapshotRepairMarker(storage);
  throw rejectionError ?? resultFailure;
}

export async function refreshLivenessFeedSnapshotWithRetry(
  storage: DurableObjectStorage,
  feedChanged: boolean,
  refresh: () => Promise<unknown>,
): Promise<boolean> {
  let pending = feedChanged;
  if (!pending) {
    try {
      pending = await storage.get<boolean>(LIVENESS_FEED_SNAPSHOT_PENDING_KEY) === true;
    } catch (error) {
      // An unreadable marker cannot prove the snapshot is current. Refresh
      // conservatively; publishing an unchanged hash does not rewrite R2.
      console.error("video-liveness-feed-repair-marker-read-failed", errorMessage(error));
      pending = true;
    }
  }
  if (!pending) return false;

  // Record the repair obligation before touching R2. If this write itself is
  // unavailable, still attempt the publish immediately instead of losing the
  // only repair opportunity after the liveness cursor has advanced.
  let markerPersisted = await persistSnapshotRepairMarker(storage);
  try {
    await refresh();
  } catch (error) {
    // The first marker write may have failed transiently. Retry once after the
    // publish failure so the next scheduler alarm can complete the repair.
    if (!markerPersisted) {
      markerPersisted = await persistSnapshotRepairMarker(storage);
    }
    throw error;
  }
  if (markerPersisted) {
    await storage.delete(LIVENESS_FEED_SNAPSHOT_PENDING_KEY);
  }
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
  let results: unknown[];
  try {
    results = await collectLivenessResults(storage, pending);
  } catch (error) {
    // The result is uncertain only after the scheduled work has settled. Repair
    // the snapshot in the same alarm; DO-backed runs also retain the durable
    // marker, while the direct path has no marker and must rebuild immediately.
    try {
      if (storage) {
        await refreshLivenessFeedSnapshotWithRetry(
          storage,
          true,
          () => refreshFeedSnapshot(env),
        );
      } else {
        await refreshCompactedFeedSnapshot(env);
      }
    } catch (repairError) {
      console.error("video-liveness-feed-repair-after-failure-failed", errorMessage(repairError));
    }
    throw error;
  }
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
