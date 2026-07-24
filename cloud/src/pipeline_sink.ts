import type { Env } from "./sources";

export async function sendPipelineRecordsBestEffort(
  env: Env,
  records: readonly Record<string, unknown>[],
): Promise<boolean> {
  if (!records.length || !env.HOMEPANEL_PIPELINE?.send) return false;
  try {
    await env.HOMEPANEL_PIPELINE.send([...records]);
    return true;
  } catch (error) {
    console.error("homepanel-pipeline-send-failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}
