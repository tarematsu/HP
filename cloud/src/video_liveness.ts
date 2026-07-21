import { runLivenessMonitor } from "../../video/src/liveness-monitor.js";
import type { Env } from "./sources";

export async function runVideoLiveness(env: Env): Promise<void> {
  await runLivenessMonitor(env);
}
