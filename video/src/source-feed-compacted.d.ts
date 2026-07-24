export interface FeedCandidate {
  key?: string;
  canonicalKey?: string;
}

export interface FeedFinalizeOptions {
  groupKey?: string;
  replaceItems?: FeedCandidate[];
  desiredItems?: FeedCandidate[];
  mergeItems?: FeedCandidate[];
  lock?: boolean;
}

export function synchronizeCompactedFeed(
  env: unknown,
  capturedAt?: string,
  options?: FeedFinalizeOptions,
): Promise<number>;

export function finalizeCompactedFeedLocally(
  env: unknown,
  capturedAt?: string,
  options?: FeedFinalizeOptions,
): Promise<number>;

export function finalizeCompactedFeed(
  env: unknown,
  capturedAt?: string,
  options?: FeedFinalizeOptions,
): Promise<number>;

export function stageCompactedFeedCandidates(env: unknown, items: FeedCandidate[]): Promise<number>;
export function refreshCompactedFeedSnapshot(env: unknown, capturedAt?: string): Promise<number>;
