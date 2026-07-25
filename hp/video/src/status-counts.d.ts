export interface VideoStatusCounts {
  activeVideos: number;
  activeMp4Videos: number;
  feedVideos: number;
  feedMp4Videos: number;
  blockedVideos: number;
  deathVideos: number;
  countsDirty: number;
  countsUpdatedAt: string | null;
}

export function emptyStatusCounts(): VideoStatusCounts;
export function prepareStatusCountsRead(db: D1Database): D1PreparedStatement;
export function refreshStatusVideoCounts(db: D1Database, capturedAt?: string): Promise<void>;
export function refreshStatusExclusionCounts(db: D1Database, capturedAt?: string): Promise<void>;
export function refreshStatusCounts(db: D1Database, capturedAt?: string): Promise<VideoStatusCounts>;
export function readStatusCounts(db: D1Database): Promise<VideoStatusCounts>;

export const STATUS_COUNTS_CLEAR_DIRTY: string;
export const STATUS_COUNTS_READ: string;
export const STATUS_EXCLUSION_COUNTS_REFRESH: string;
export const STATUS_VIDEO_COUNTS_REFRESH: string;
