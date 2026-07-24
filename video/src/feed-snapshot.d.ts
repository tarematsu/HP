export interface FeedSnapshotRow {
  videoId?: number;
  id?: number;
  mediaUrl?: string;
}

export interface FeedSnapshotPageOptions {
  limit: number;
  cursor?: string | null;
  seed: number;
  orientation?: string;
}

export function readFeedSnapshotPage(
  db: D1Database,
  options: FeedSnapshotPageOptions,
): Promise<{ items: Array<{ id: number; mediaUrl: string }>; nextCursor: string | null } | null>;

export function publishFeedSnapshot(
  env: unknown,
  rows: FeedSnapshotRow[],
  contentHash: string,
  generatedAt: string,
): Promise<{ written: boolean; rowCount?: number; reason?: string }>;

export function refreshFeedSnapshot(env: unknown, generatedAt?: string): Promise<number>;
export function invalidateFeedSnapshotCache(db: D1Database): void;
export const SNAPSHOT_KEY: string;
