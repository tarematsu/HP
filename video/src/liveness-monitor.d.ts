export interface VideoLivenessRunResult {
  ok: true;
  skipped: boolean;
  reason?: string;
  checkedCount?: number;
  deadCount?: number;
  revivedCount?: number;
  unknownCount?: number;
}

export function runLivenessMonitor(env: unknown): Promise<VideoLivenessRunResult>;
