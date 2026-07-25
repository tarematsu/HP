export interface VideoLivenessRunResult {
  ok: true;
  skipped: boolean;
  reason?: string;
  checkedCount?: number;
  deadCount?: number;
  revivedCount?: number;
  unknownCount?: number;
}

export const LIVENESS_BATCH_SIZE: number;
export const BASE_LIVENESS_SELECT_SQL: string;

export function runLivenessMonitor(env: unknown): Promise<VideoLivenessRunResult>;
