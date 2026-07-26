import { refreshFeedSnapshot } from './feed-snapshot.js';
import { finalizeCompactedFeedLocally } from './source-feed-compacted.js';

const VIDEO_FEED_GROUP_DAYS_KEY = 'video-feed-group-days-v1';
const VIDEO_FEED_CANONICAL_PREFIX = 'video-feed-canonical-v1';
const VIDEO_FEED_COUNT_KEY = 'video-feed-count-v1';
const EXPECTED_SCHEDULED_FEED_GROUPS = 2;
const CANDIDATE_CHUNK_SIZE = 500;
const MAX_FEED_ITEMS = 2_000;

function candidateKey(value) {
  return String(value?.key ?? value?.canonicalKey ?? '').trim();
}

function normalizedCandidates(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const key = candidateKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ key });
    if (result.length >= MAX_FEED_ITEMS) break;
  }
  return result;
}

function mergedCandidates(current, incoming) {
  const result = current.map((candidate) => ({ key: candidate.key }));
  const seen = new Set(result.map((candidate) => candidate.key));
  for (const candidate of incoming) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    result.push({ key: candidate.key });
    if (result.length >= MAX_FEED_ITEMS) break;
  }
  return result;
}

function collectionDay(capturedAt) {
  const prefix = capturedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix)
    ? prefix
    : new Date().toISOString().slice(0, 10);
}

function groupPrefix(groupKey) {
  return `video-feed-group-v1:${encodeURIComponent(groupKey)}`;
}

function metaKey(prefix) {
  return `${prefix}:meta`;
}

function chunkKey(prefix, index) {
  return `${prefix}:chunk:${index}`;
}

async function readCandidateSet(storage, prefix) {
  const meta = await storage.get(metaKey(prefix));
  if (!meta || !Number.isSafeInteger(meta.chunks) || meta.chunks < 0) return null;
  const result = [];
  for (let index = 0; index < meta.chunks; index += 1) {
    const chunk = await storage.get(chunkKey(prefix, index));
    if (!Array.isArray(chunk)) return null;
    for (const candidate of chunk) {
      if (candidate?.key) result.push({ key: String(candidate.key) });
    }
  }
  return result.slice(0, MAX_FEED_ITEMS);
}

async function writeCandidateSet(storage, prefix, candidates) {
  const previous = await storage.get(metaKey(prefix));
  const chunks = Math.ceil(candidates.length / CANDIDATE_CHUNK_SIZE);
  for (let index = 0; index < chunks; index += 1) {
    await storage.put(
      chunkKey(prefix, index),
      candidates.slice(index * CANDIDATE_CHUNK_SIZE, (index + 1) * CANDIDATE_CHUNK_SIZE),
    );
  }
  await storage.put(metaKey(prefix), { chunks, count: candidates.length });
  const previousChunks = Math.max(0, Number(previous?.chunks ?? 0));
  for (let index = chunks; index < previousChunks; index += 1) {
    await storage.delete(chunkKey(prefix, index));
  }
}

function unionCandidateSets(sets) {
  const result = [];
  const seen = new Set();
  for (const set of sets) {
    for (const candidate of set) {
      if (!candidate.key || seen.has(candidate.key)) continue;
      seen.add(candidate.key);
      result.push({ key: candidate.key });
      if (result.length >= MAX_FEED_ITEMS) return result;
    }
  }
  return result;
}

export class VideoFeedCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async currentCandidates() {
    const stored = await readCandidateSet(this.state.storage, VIDEO_FEED_CANONICAL_PREFIX);
    if (stored) return stored;
    const result = await this.env.DB.prepare(
      `SELECT video.canonical_key AS canonicalKey
         FROM ranking_entries AS ranking
         INNER JOIN videos AS video ON video.id = ranking.video_id
        WHERE ranking.period = '24h'
          AND video.status = 'active'
        ORDER BY ranking.rank, ranking.video_id
        LIMIT ?`,
    ).bind(MAX_FEED_ITEMS).all();
    const candidates = normalizedCandidates(
      (result.results ?? []).map((row) => ({ canonicalKey: row.canonicalKey })),
    );
    await writeCandidateSet(this.state.storage, VIDEO_FEED_CANONICAL_PREFIX, candidates);
    return candidates;
  }

  async mergeIntoCanonical(value) {
    const candidates = mergedCandidates(
      await this.currentCandidates(),
      normalizedCandidates(value),
    );
    await writeCandidateSet(this.state.storage, VIDEO_FEED_CANONICAL_PREFIX, candidates);
    return candidates;
  }

  async feedPlan(body, capturedAt) {
    const groupKey = typeof body.groupKey === 'string' ? body.groupKey.trim().slice(0, 200) : '';
    if (groupKey) {
      const day = collectionDay(capturedAt);
      const groupDays = await this.state.storage.get(VIDEO_FEED_GROUP_DAYS_KEY) ?? {};
      if (Array.isArray(body.replaceItems)) {
        const submitted = normalizedCandidates(body.replaceItems);
        await writeCandidateSet(this.state.storage, groupPrefix(groupKey), submitted);
        groupDays[groupKey] = day;
        await this.state.storage.put(VIDEO_FEED_GROUP_DAYS_KEY, groupDays);
      }
      const currentGroupKeys = Object.entries(groupDays)
        .filter(([, value]) => value === day)
        .map(([key]) => key)
        .sort();
      if (currentGroupKeys.length < EXPECTED_SCHEDULED_FEED_GROUPS) return { ready: false };
      const sets = [];
      for (const key of currentGroupKeys.slice(0, EXPECTED_SCHEDULED_FEED_GROUPS)) {
        sets.push(await readCandidateSet(this.state.storage, groupPrefix(key)) ?? []);
      }
      const candidates = unionCandidateSets(sets);
      await writeCandidateSet(this.state.storage, VIDEO_FEED_CANONICAL_PREFIX, candidates);
      return { ready: true, items: candidates };
    }

    if (Array.isArray(body.replaceItems)) {
      const candidates = normalizedCandidates(body.replaceItems);
      await writeCandidateSet(this.state.storage, VIDEO_FEED_CANONICAL_PREFIX, candidates);
      return { ready: true, items: candidates };
    }
    if (Array.isArray(body.mergeItems)) {
      return { ready: true, items: await this.mergeIntoCanonical(body.mergeItems) };
    }
    return { ready: true, items: await this.currentCandidates() };
  }

  async existingFeedCount() {
    const stored = await this.state.storage.get(VIDEO_FEED_COUNT_KEY);
    if (Number.isFinite(stored)) return Math.max(0, Number(stored));
    const row = await this.env.DB.prepare(
      'SELECT row_count AS rowCount FROM playback_feed_state WHERE id=1',
    ).first();
    const count = Math.max(0, Number(row?.rowCount ?? 0));
    await this.state.storage.put(VIDEO_FEED_COUNT_KEY, count);
    return count;
  }

  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, {
        status: 405,
        headers: { Allow: 'POST' },
      });
    }

    const path = new URL(request.url).pathname;
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (path === '/video-feed-stage') {
      const candidates = await this.mergeIntoCanonical(body.mergeItems);
      return Response.json({ candidateCount: candidates.length }, { status: 202 });
    }
    if (path === '/video-feed-finalize') {
      const capturedAt = typeof body.capturedAt === 'string' && body.capturedAt
        ? body.capturedAt
        : new Date().toISOString();
      const plan = await this.feedPlan(body, capturedAt);
      if (!plan.ready) {
        return Response.json({ count: await this.existingFeedCount(), deferred: true });
      }
      const count = await finalizeCompactedFeedLocally(this.env, capturedAt, {
        replaceItems: plan.items,
      });
      await this.state.storage.put(VIDEO_FEED_COUNT_KEY, count);
      return Response.json({ count, deferred: false });
    }
    if (path === '/video-feed-refresh') {
      const capturedAt = typeof body.capturedAt === 'string' && body.capturedAt
        ? body.capturedAt
        : new Date().toISOString();
      const count = await refreshFeedSnapshot(this.env, capturedAt);
      await this.state.storage.put(VIDEO_FEED_COUNT_KEY, count);
      return Response.json({ count });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
}
