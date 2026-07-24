import { refreshFeedSnapshot } from "../../video/src/feed-snapshot.js";
import { finalizeCompactedFeedLocally } from "../../video/src/source-feed-compacted.js";
import {
  buildDeviceSyncPayloadForDevice,
  readDeviceSyncManifest,
  type DeviceSyncManifestRow,
} from "./device_sync";
import { DEVICE_SYNC_MANIFEST_KEY } from "./device_sync_coordinator";
import { radarBundleShardResponse } from "./radar_bundle";
import { registerRuntimeStorage } from "./runtime_storage_registry";
import {
  refreshRuntimeJobs,
  runRuntimeSchedulerTick,
  runtimeNextWakeAt,
} from "./scheduler_runtime";
import type { Env } from "./sources";

const COORDINATOR_NAME = "global";
const ENSURE_THROTTLE_MS = 15 * 60_000;
const WATCHDOG_THROTTLE_MS = 24 * 60 * 60_000;
const MIN_ALARM_DELAY_MS = 1_000;
const RECOVERY_ALARM_DELAY_MS = 60_000;
const VIDEO_FEED_GROUP_DAYS_KEY = "video-feed-group-days-v1";
const VIDEO_FEED_CANONICAL_PREFIX = "video-feed-canonical-v1";
const VIDEO_FEED_COUNT_KEY = "video-feed-count-v1";
const EXPECTED_SCHEDULED_FEED_GROUPS = 2;
const CANDIDATE_CHUNK_SIZE = 500;
const MAX_FEED_ITEMS = 2_000;

interface SchedulerEnv extends Env {
  SCHEDULER_COORDINATOR?: DurableObjectNamespace;
}

interface WakeRequest {
  names?: unknown;
}

interface DeviceSyncRequest {
  deviceId?: unknown;
  versions?: unknown;
}

interface FeedFinalizeRequest {
  capturedAt?: unknown;
  groupKey?: unknown;
  replaceItems?: unknown;
  mergeItems?: unknown;
}

interface FeedRefreshRequest {
  capturedAt?: unknown;
}

interface CandidateSetMeta {
  chunks: number;
  count: number;
}

type FeedCandidate = { key: string };
type FeedGroupDays = Record<string, string>;
type FeedPlan = { ready: false } | { ready: true; items: FeedCandidate[] };

let nextEnsureAllowedAt = 0;
let nextWatchdogAllowedAt = 0;

function namespaceFor(env: Env): DurableObjectNamespace | null {
  return (env as SchedulerEnv).SCHEDULER_COORDINATOR ?? null;
}

function coordinatorStub(env: Env): DurableObjectStub | null {
  const namespace = namespaceFor(env);
  if (!namespace) return null;
  return namespace.get(namespace.idFromName(COORDINATOR_NAME));
}

function candidateKey(value: Record<string, unknown>): string {
  return String(value.key ?? value.canonicalKey ?? "").trim();
}

function normalizedCandidates(value: unknown): FeedCandidate[] {
  if (!Array.isArray(value)) return [];
  const result: FeedCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const key = candidateKey(raw as Record<string, unknown>);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ key });
    if (result.length >= MAX_FEED_ITEMS) break;
  }
  return result;
}

function mergedCandidates(current: readonly FeedCandidate[], incoming: readonly FeedCandidate[]): FeedCandidate[] {
  const result = current.map(candidate => ({ key: candidate.key }));
  const seen = new Set(result.map(candidate => candidate.key));
  for (const candidate of incoming) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    result.push({ key: candidate.key });
    if (result.length >= MAX_FEED_ITEMS) break;
  }
  return result;
}

function collectionDay(capturedAt: string): string {
  const prefix = capturedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix)
    ? prefix
    : new Date().toISOString().slice(0, 10);
}

function groupPrefix(groupKey: string): string {
  return `video-feed-group-v1:${encodeURIComponent(groupKey)}`;
}

function metaKey(prefix: string): string {
  return `${prefix}:meta`;
}

function chunkKey(prefix: string, index: number): string {
  return `${prefix}:chunk:${index}`;
}

async function readCandidateSet(
  storage: DurableObjectStorage,
  prefix: string,
): Promise<FeedCandidate[] | null> {
  const meta = await storage.get<CandidateSetMeta>(metaKey(prefix));
  if (!meta || !Number.isSafeInteger(meta.chunks) || meta.chunks < 0) return null;
  const result: FeedCandidate[] = [];
  for (let index = 0; index < meta.chunks; index += 1) {
    const chunk = await storage.get<FeedCandidate[]>(chunkKey(prefix, index));
    if (!Array.isArray(chunk)) return null;
    for (const candidate of chunk) {
      if (candidate?.key) result.push({ key: String(candidate.key) });
    }
  }
  return result.slice(0, MAX_FEED_ITEMS);
}

async function writeCandidateSet(
  storage: DurableObjectStorage,
  prefix: string,
  candidates: readonly FeedCandidate[],
): Promise<void> {
  const previous = await storage.get<CandidateSetMeta>(metaKey(prefix));
  const chunks = Math.ceil(candidates.length / CANDIDATE_CHUNK_SIZE);
  for (let index = 0; index < chunks; index += 1) {
    await storage.put(
      chunkKey(prefix, index),
      candidates.slice(index * CANDIDATE_CHUNK_SIZE, (index + 1) * CANDIDATE_CHUNK_SIZE),
    );
  }
  await storage.put(metaKey(prefix), { chunks, count: candidates.length } satisfies CandidateSetMeta);
  const previousChunks = Math.max(0, Number(previous?.chunks ?? 0));
  for (let index = chunks; index < previousChunks; index += 1) {
    await storage.delete(chunkKey(prefix, index));
  }
}

function unionCandidateSets(sets: readonly FeedCandidate[][]): FeedCandidate[] {
  const result: FeedCandidate[] = [];
  const seen = new Set<string>();
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

async function signalCoordinator(
  env: Env,
  path: "/ensure" | "/wake",
  names?: readonly string[],
): Promise<void> {
  const stub = coordinatorStub(env);
  if (!stub) return;
  const init: RequestInit = names === undefined
    ? { method: "POST" }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      };
  const response = await stub.fetch(`https://scheduler.internal${path}`, init);
  if (!response.ok) throw new Error(`scheduler coordinator ${path} failed: HTTP ${response.status}`);
}

export function queueSchedulerEnsure(
  env: Env,
  ctx: ExecutionContext,
  now = Date.now(),
): boolean {
  if (!namespaceFor(env) || now < nextEnsureAllowedAt) return false;
  nextEnsureAllowedAt = now + ENSURE_THROTTLE_MS;
  ctx.waitUntil(signalCoordinator(env, "/ensure").catch(error => {
    nextEnsureAllowedAt = 0;
    console.error("Failed to ensure scheduler alarm", error instanceof Error ? error.message : String(error));
  }));
  return true;
}

export function queueSchedulerWatchdog(
  env: Env,
  ctx: ExecutionContext,
  now = Date.now(),
): boolean {
  if (!namespaceFor(env) || now < nextWatchdogAllowedAt) return false;
  nextWatchdogAllowedAt = now + WATCHDOG_THROTTLE_MS;
  ctx.waitUntil(signalCoordinator(env, "/ensure").catch(error => {
    nextWatchdogAllowedAt = 0;
    console.error("Failed to run scheduler watchdog", error instanceof Error ? error.message : String(error));
  }));
  return true;
}

export function queueSchedulerWake(
  env: Env,
  ctx: ExecutionContext,
  names?: readonly string[],
): boolean {
  if (!namespaceFor(env)) return false;
  ctx.waitUntil(signalCoordinator(env, "/wake", names).catch(error => {
    console.error("Failed to wake scheduler alarm", error instanceof Error ? error.message : String(error));
  }));
  return true;
}

export class SchedulerCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    registerRuntimeStorage(env, state.storage);
  }

  private async nextWakeAt(nowMs = Date.now()): Promise<number> {
    const desired = await runtimeNextWakeAt(this.state, this.env, nowMs);
    return Math.max(nowMs + MIN_ALARM_DELAY_MS, desired);
  }

  private async setEarlierAlarm(desiredAt: number): Promise<number> {
    const current = await this.state.storage.getAlarm();
    if (current === null || desiredAt < current) {
      await this.state.storage.setAlarm(desiredAt);
      return desiredAt;
    }
    return current;
  }

  private async scheduleNext(): Promise<number> {
    return this.setEarlierAlarm(await this.nextWakeAt());
  }

  private async deviceSyncManifest(): Promise<DeviceSyncManifestRow> {
    const stored = await this.state.storage.get<DeviceSyncManifestRow>(DEVICE_SYNC_MANIFEST_KEY);
    if (stored) return stored;
    const manifest = await readDeviceSyncManifest(this.env);
    await this.state.storage.put(DEVICE_SYNC_MANIFEST_KEY, manifest);
    return manifest;
  }

  private async currentCandidates(): Promise<FeedCandidate[]> {
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
    ).bind(MAX_FEED_ITEMS).all<{ canonicalKey: string }>();
    const candidates = normalizedCandidates(
      (result.results ?? []).map(row => ({ canonicalKey: row.canonicalKey })),
    );
    await writeCandidateSet(this.state.storage, VIDEO_FEED_CANONICAL_PREFIX, candidates);
    return candidates;
  }

  private async mergeIntoCanonical(value: unknown): Promise<FeedCandidate[]> {
    const candidates = mergedCandidates(
      await this.currentCandidates(),
      normalizedCandidates(value),
    );
    await writeCandidateSet(this.state.storage, VIDEO_FEED_CANONICAL_PREFIX, candidates);
    return candidates;
  }

  private async feedPlan(body: FeedFinalizeRequest, capturedAt: string): Promise<FeedPlan> {
    const groupKey = typeof body.groupKey === "string" ? body.groupKey.trim().slice(0, 200) : "";
    if (groupKey) {
      const day = collectionDay(capturedAt);
      const groupDays = await this.state.storage.get<FeedGroupDays>(VIDEO_FEED_GROUP_DAYS_KEY) ?? {};
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
      const sets: FeedCandidate[][] = [];
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

  private async existingFeedCount(): Promise<number> {
    const stored = await this.state.storage.get<number>(VIDEO_FEED_COUNT_KEY);
    if (Number.isFinite(stored)) return Math.max(0, Number(stored));
    const row = await this.env.DB.prepare(
      "SELECT row_count AS rowCount FROM playback_feed_state WHERE id=1",
    ).first<{ rowCount: number }>();
    const count = Math.max(0, Number(row?.rowCount ?? 0));
    await this.state.storage.put(VIDEO_FEED_COUNT_KEY, count);
    return count;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, {
        status: 405,
        headers: { Allow: "POST" },
      });
    }
    const path = new URL(request.url).pathname;
    if (path === "/radar-bundle-shard") {
      return radarBundleShardResponse(request, this.env);
    }
    if (path === "/device-sync-invalidate") {
      await this.state.storage.delete(DEVICE_SYNC_MANIFEST_KEY);
      return Response.json({ invalidated: true }, { status: 202 });
    }
    if (path === "/device-sync") {
      let body: DeviceSyncRequest = {};
      try { body = await request.json<DeviceSyncRequest>(); } catch { body = {}; }
      const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
      const versions = body.versions && typeof body.versions === "object" && !Array.isArray(body.versions)
        ? body.versions as Record<string, unknown>
        : {};
      if (!deviceId) return Response.json({ error: "invalid_device_id" }, { status: 400 });
      return Response.json(await buildDeviceSyncPayloadForDevice(
        this.env,
        deviceId,
        versions,
        await this.deviceSyncManifest(),
      ));
    }
    if (path === "/video-feed-stage") {
      let body: FeedFinalizeRequest = {};
      try { body = await request.json<FeedFinalizeRequest>(); } catch { body = {}; }
      const candidates = await this.mergeIntoCanonical(body.mergeItems);
      return Response.json({ candidateCount: candidates.length }, { status: 202 });
    }
    if (path === "/video-feed-finalize") {
      let body: FeedFinalizeRequest = {};
      try { body = await request.json<FeedFinalizeRequest>(); } catch { body = {}; }
      const capturedAt = typeof body.capturedAt === "string" && body.capturedAt
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
    if (path === "/video-feed-refresh") {
      let body: FeedRefreshRequest = {};
      try { body = await request.json<FeedRefreshRequest>(); } catch { body = {}; }
      const capturedAt = typeof body.capturedAt === "string" && body.capturedAt
        ? body.capturedAt
        : new Date().toISOString();
      const count = await refreshFeedSnapshot(this.env, capturedAt);
      await this.state.storage.put(VIDEO_FEED_COUNT_KEY, count);
      return Response.json({ count });
    }
    if (path === "/wake") {
      let body: WakeRequest = {};
      try {
        body = await request.json<WakeRequest>();
      } catch {
        body = {};
      }
      const names = Array.isArray(body.names)
        ? body.names.filter((name): name is string => typeof name === "string")
        : undefined;
      const changed = await refreshRuntimeJobs(this.state, this.env, names);
      const alarmAt = await this.setEarlierAlarm(Date.now() + MIN_ALARM_DELAY_MS);
      return Response.json({ scheduled: true, changed, alarmAt }, { status: 202 });
    }
    if (path === "/ensure") {
      const alarmAt = await this.scheduleNext();
      return Response.json({ scheduled: true, alarmAt }, { status: 202 });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    try {
      await runRuntimeSchedulerTick(this.state, this.env);
    } catch (error) {
      console.error("Scheduler alarm job failed", error instanceof Error ? error.message : String(error));
    }

    try {
      await this.state.storage.setAlarm(await this.nextWakeAt());
    } catch (error) {
      console.error("Failed to schedule the next scheduler alarm", error instanceof Error ? error.message : String(error));
      await this.state.storage.setAlarm(Date.now() + RECOVERY_ALARM_DELAY_MS);
    }
  }
}
