import { fetchJson } from "./http";
import type { Env, SourceResult } from "./sources";

type MonitorTrack = {
  position?: number;
  spotify_id?: string | null;
  title?: string | null;
  artist?: string | null;
  display_title?: string | null;
  thumbnail_url?: string | null;
  spotify_url?: string | null;
  duration_ms?: number | null;
  metadata_fetched_at?: number | null;
  is_current?: boolean;
  progress_ms?: number | null;
};

type MonitorPayload = {
  ok?: boolean;
  error?: string;
  generated_at?: number;
  latest_observed_at?: number | null;
  queue_observed_at?: number | null;
  station_id?: number | null;
  is_broadcasting?: boolean;
  playing?: boolean;
  host_account_id?: number | null;
  host_handle?: string | null;
  broadcast_start_time?: number | null;
  queue_revision?: string | null;
  queue_status?: {
    current_index?: number;
    progress_ms?: number;
    anchor_at?: number | null;
    queue_end_at?: number | null;
    total_items?: number;
    is_paused?: boolean;
  } | null;
  queue?: MonitorTrack[];
};

type QueueItem = {
  spotifyId: string;
  name: string;
  artist: string;
  artwork: string;
  uri: string;
  durationMs: number;
  position: number;
  metadataFetchedAt: number | null;
};

function finite(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function playbackFeedUrl(value: string): string {
  const url = new URL(value);
  if (url.pathname.endsWith("/api/dashboard")) {
    url.pathname = url.pathname.slice(0, -"/api/dashboard".length) + "/api/playback";
  } else if (!url.pathname.endsWith("/api/playback")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/playback`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function readMonitor(env: Env): Promise<MonitorPayload | null> {
  const configured = env.STATIONHEAD_MONITOR_URL?.trim();
  if (!configured) return null;
  const payload = await fetchJson<MonitorPayload>(playbackFeedUrl(configured), {
    headers: { Accept: "application/json" },
  });
  if (payload.ok === false) throw new Error(payload.error || "Stationhead playback feed failed");
  return payload;
}

function monitorQueue(payload: MonitorPayload | null): QueueItem[] {
  return (payload?.queue ?? []).map((track, index) => {
    const id = String(track.spotify_id ?? "").trim();
    const name = String(track.title || track.display_title || id || "曲情報なし").trim();
    return {
      spotifyId: id,
      name,
      artist: String(track.artist ?? "").trim(),
      artwork: String(track.thumbnail_url ?? "").trim(),
      uri: id ? `spotify:track:${id}` : String(track.spotify_url ?? "").trim(),
      durationMs: Math.max(0, finite(track.duration_ms)),
      position: finite(track.position, index),
      metadataFetchedAt: Number.isFinite(Number(track.metadata_fetched_at)) ? Number(track.metadata_fetched_at) : null,
    };
  });
}

function monitorCurrentIndex(payload: MonitorPayload | null): number {
  const queue = payload?.queue ?? [];
  if (!queue.length) return -1;
  const generatedAt = finite(payload?.generated_at);
  const queueEndAt = finite(payload?.queue_status?.queue_end_at);
  if (generatedAt > 0 && queueEndAt > 0 && generatedAt >= queueEndAt) return -1;
  const statusIndex = Math.trunc(finite(payload?.queue_status?.current_index, -1));
  if (statusIndex < 0 || statusIndex >= queue.length) return -1;
  const explicit = queue.findIndex(track => track.is_current);
  return explicit >= 0 ? explicit : statusIndex;
}

function queueEndAt(queue: QueueItem[], currentIndex: number, anchorAt: number): number | null {
  if (currentIndex < 0 || currentIndex >= queue.length || !Number.isFinite(anchorAt)) return null;
  return queue.slice(currentIndex).reduce((end, track) => end + track.durationMs, anchorAt);
}

/** Stationhead Monitorが追跡するBuddiesチャンネル。Spotify Web APIは端末側だけで扱う。 */
export async function fetchStationhead(env: Env): Promise<SourceResult> {
  const sampledAt = Date.now();
  let monitor: MonitorPayload | null = null;
  let monitorError: string | null = null;
  try {
    monitor = await readMonitor(env);
  } catch (error) {
    monitorError = error instanceof Error ? error.message : String(error);
  }

  const queue = monitorQueue(monitor);
  const currentIndex = monitorCurrentIndex(monitor);
  const monitorGeneratedAt = Math.max(0, finite(monitor?.generated_at));
  const monitorProgressMs = currentIndex >= 0 ? Math.max(0, finite(
    monitor?.queue?.[currentIndex]?.progress_ms,
    finite(monitor?.queue_status?.progress_ms),
  )) : 0;
  const anchorAt = currentIndex >= 0
    ? finite(monitor?.queue_status?.anchor_at, monitorGeneratedAt - monitorProgressMs)
    : 0;
  const playing = Boolean(monitor?.playing && currentIndex >= 0);

  const currentItem = currentIndex >= 0 ? queue[currentIndex] ?? null : null;
  const durationMs = currentItem?.durationMs ?? 0;
  const expectedEndAt = playing && durationMs > monitorProgressMs ? anchorAt + durationMs : null;
  const calculatedQueueEndAt = queueEndAt(queue, currentIndex, anchorAt);

  return {
    source: "stationhead",
    payload: {
      configured: Boolean(env.STATIONHEAD_MONITOR_URL?.trim()),
      connected: Boolean(monitor),
      source: "stationhead-monitor",
      channel: "Buddies",
      monitorAvailable: Boolean(monitor),
      playing,
      error: monitor ? null : (monitorError || "Stationhead monitor unavailable"),
      monitorError,
      sampledAt,
      monitorSampledAt: monitorGeneratedAt || null,
      progressMs: monitorProgressMs,
      durationMs,
      anchorAt: anchorAt || null,
      expectedEndAt,
      queueEndAt: calculatedQueueEndAt ?? monitor?.queue_status?.queue_end_at ?? null,
      currentIndex,
      queueRevision: monitor?.queue_revision ?? null,
      host: monitor ? {
        accountId: monitor.host_account_id ?? null,
        handle: monitor.host_handle ?? "",
        broadcastStartTime: monitor.broadcast_start_time ?? null,
      } : null,
      item: currentItem ? {
        name: currentItem.name,
        artist: currentItem.artist,
        artwork: currentItem.artwork,
        uri: currentItem.uri,
        spotifyId: currentItem.spotifyId,
        durationMs: currentItem.durationMs,
      } : null,
      queue,
    },
    observedAt: sampledAt,
  };
}
