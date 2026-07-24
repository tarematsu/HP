import videoWorker from "../../video/src/entry-core.js";
import { LIVENESS_CRON } from "../../video/src/liveness-schedule.js";
import { livenessDoDatabase } from "./liveness_do_db";
import { runtimeStorageFor } from "./runtime_storage_registry";
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

  const durableStorage = storage ?? runtimeStorageFor(env);
  const runtimeEnv = durableStorage ? { ...env, DB: livenessDoDatabase(env, durableStorage) } : env;
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
}
