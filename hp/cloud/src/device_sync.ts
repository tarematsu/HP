import { deviceIdFromRequest as deviceIdFrom } from "./auth";
import {
  claimPendingDeviceCommands,
  COMMAND_REDELIVERY_MS,
} from "./device_command_delivery";
import { readR2EnvironmentState } from "./environment_r2";
import { json } from "./http";
import {
  DASHBOARD_SOURCE_NAMES,
  dashboardPayload,
  WORKER_VERSION,
  type StateRow,
} from "./snapshot";
import { normalizeDeviceSyncVersions } from "./device_sync_versions";
import type { Env } from "./sources";
import { stationheadHealthPayload } from "./stationhead_health";
import {
  normalizeSpotifyEpisodeUrl,
  normalizeSpotifyShowUrl,
  resolveLatestSpotifyTalkAboutEpisode,
} from "./spotify_talkabout_latest";

type SyncSourceName = typeof DASHBOARD_SOURCE_NAMES[number] | "radar" | "stationhead_health";
type JsonRecord = Record<string, unknown>;

export interface DeviceSyncManifestRow {
  dashboard_version: number;
  environment_version: number;
  environment_fetched_at: number;
  radar_version: number;
  switchbot_version: number;
  stationhead_version: number;
  stationhead_health_version: number;
}

interface DeviceSyncSnapshotRow {
  config_version: number;
  config_updated_at: number;
  config_payload: string | null;
  pending: number;
}

function requestedVersion(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
}

function optionalRequestedVersion(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return requestedVersion(value);
}

function objectOrNull(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

const LEGACY_SPOTIFY_RANDOM_TRACK_IDS = [
  "4ljk3qMzdU81kWzxcNix3F", "2hi8kIoKC8tRMDajdkoYFL", "2kiCcs4rC55nlHQ1djMTt6",
  "3HdmFZGqZLNiCAfiNj4N84", "145bvRRC27wMYn9GNtTg57", "6GF0ZgT8wlksWrlLTfGmlU",
  "4HCPWhwMu93z1jnpxw5OGM", "7vvZ1QHTdkoEXBiOBdxdIo", "6QmAwjzLQy6SjUyvGzSCG4",
  "3SOOYBTDQBUe9vkavji2ZI", "5vRGSkQiKlJudkJ2vUKIOe", "4YUoggoqC3KIxts61kmlqw",
  "6ZOaQShLJdbZYvPoi1xOdE", "0yv01vKbOmS1UMS9XyN5ar", "6O3XAkrjMG1T4x8jvdpbrp",
  "4J2JsdELLCewlR7kISsw70", "6jxiPZV3Aopxbi33i09uFQ", "12YgUwcZKUCnYWccet8qJq",
  "4AZXBU2rt8yCcEA1pttXLB", "6ncW1pJ5bHOum76AL2P08a", "6whOTYjcMh396LLbqig8jq",
  "49cxVtrML7Xo63UFaaJrUR", "2MPm0NrgPoMr6ee7je9afe", "5DrxCKjopmd7UL1pJWqBHK",
  "4PaLKbIU8NvguxcrjMvHXh", "6J8Vaiow1E75EQs9RnMfZp", "5xUQGRuP4LPk4ESl1xbmFs",
  "11KKagWroMV5UXbK50hZxZ", "33liCluqUasE65nMv3KLLm", "5QnQ7m9OxSoFeSPSz8grqX",
  "2ze5Hu3eRRe6HxJTfuZaA0", "4IfRFec7SNKOWw1HzpiqHQ", "2CMSkSwIfnNQR7bTNFFeB5",
  "2meBhRDzQpf0ltQH11HbWG",
] as const;

const SHORT_SPOTIFY_RANDOM_TRACKS = [
  ["Sunny side up", "5xUQGRuP4LPk4ESl1xbmFs"],
  ["キスが苦い", "4PaLKbIU8NvguxcrjMvHXh"],
  ["やるしかないじゃん", "6GF0ZgT8wlksWrlLTfGmlU"],
  ["恋愛無双", "5vRGSkQiKlJudkJ2vUKIOe"],
  ["死んだふり", "6QmAwjzLQy6SjUyvGzSCG4"],
  ["Make or Break", "7vvZ1QHTdkoEXBiOBdxdIo"],
  ["行かないで", "3HdmFZGqZLNiCAfiNj4N84"],
  ["ドライフルーツ", "5DrxCKjopmd7UL1pJWqBHK"],
  ["Nightmare症候群", "2hi8kIoKC8tRMDajdkoYFL"],
] as const;

const INSTRUMENTAL_SPOTIFY_RANDOM_TRACKS = [
  ["Interlude #1", "1N339Ccfo6kqPHtS5ueJ0J"],
  ["Interlude #2", "57MZ2hsDSJMp9nzFIRFd0S"],
  ["Interlude #4", "4K3nO9hBA3UE62Dspjx19d"],
  ["Interlude #6", "3IceOend8QYv0mJLCfrxQq"],
] as const;

const MANAGED_SPOTIFY_RANDOM_TRACKS = [
  ...SHORT_SPOTIFY_RANDOM_TRACKS,
  ...INSTRUMENTAL_SPOTIFY_RANDOM_TRACKS,
] as const;

function spotifyTrackId(value: unknown): string {
  const track = objectOrNull(value);
  const url = typeof track?.url === "string" ? track.url : "";
  return url.match(/\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/)?.[1] ?? "";
}

function migrateLegacySpotifyRandomPool(config: JsonRecord): boolean {
  const spotify = objectOrNull(config.spotify);
  const rotation = Array.isArray(spotify?.rotation) ? spotify.rotation : [];
  const group = rotation.find(candidate => objectOrNull(candidate)?.mode === "random");
  const random = objectOrNull(group);
  if (!random) return false;
  const tracks = Array.isArray(random?.tracks) ? random.tracks : [];
  const ids = tracks.map(spotifyTrackId);
  const isManagedPool = (expected: readonly string[]) =>
    ids.length === expected.length && ids.every((id, index) => id === expected[index]);
  const shortTrackIds = SHORT_SPOTIFY_RANDOM_TRACKS.map(([, id]) => id);
  if (!isManagedPool(LEGACY_SPOTIFY_RANDOM_TRACK_IDS) && !isManagedPool(shortTrackIds)) {
    return false;
  }
  random.tracks = MANAGED_SPOTIFY_RANDOM_TRACKS.map(([title, id]) => ({
    title,
    url: `https://open.spotify.com/track/${id}`,
  }));
  return true;
}

export async function readDeviceSyncManifest(env: Env): Promise<DeviceSyncManifestRow> {
  const row = await env.DB.prepare(
    `SELECT manifest.dashboard_version,
            manifest.environment_version,
            manifest.environment_fetched_at,
            manifest.radar_version,
            manifest.switchbot_version,
            manifest.stationhead_version,
            manifest.stationhead_health_version
       FROM sync_manifest AS manifest
      WHERE manifest.id=1`,
  ).first<DeviceSyncManifestRow>();
  return row ?? {
    dashboard_version: 0,
    environment_version: 0,
    environment_fetched_at: 0,
    radar_version: 0,
    switchbot_version: 0,
    stationhead_version: 0,
    stationhead_health_version: 0,
  };
}

async function deviceSpecificSnapshot(
  env: Env,
  deviceId: string,
  now: number,
): Promise<DeviceSyncSnapshotRow> {
  const row = await env.DB.prepare(
    `WITH config AS (
       SELECT version,updated_at,payload FROM device_configs WHERE device_id=?1
     )
     SELECT
       COALESCE((SELECT version FROM config),0) AS config_version,
       COALESCE((SELECT updated_at FROM config),0) AS config_updated_at,
       (SELECT payload FROM config) AS config_payload,
       EXISTS(
         SELECT 1 FROM device_commands
          WHERE device_id=?1
            AND command='check_update'
            AND completed_at IS NULL
            AND (expires_at IS NULL OR expires_at>?2)
            AND (delivered_at IS NULL OR delivered_at<=?3)
       ) AS pending`,
  ).bind(
    deviceId,
    now,
    now - COMMAND_REDELIVERY_MS,
  ).first<DeviceSyncSnapshotRow>();
  return row ?? {
    config_version: 0,
    config_updated_at: 0,
    config_payload: null,
    pending: 0,
  };
}

async function refreshManagedSpotifyConfig(
  env: Env,
  deviceId: string,
  snapshot: DeviceSyncSnapshotRow,
  now: number,
): Promise<DeviceSyncSnapshotRow> {
  if (!snapshot.config_payload) return snapshot;

  let config: JsonRecord;
  try {
    const parsed = objectOrNull(JSON.parse(snapshot.config_payload));
    if (!parsed) return snapshot;
    config = parsed;
  } catch {
    return snapshot;
  }

  let changed = migrateLegacySpotifyRandomPool(config);
  const spotify = objectOrNull(config.spotify);
  const talkAbout = objectOrNull(spotify?.talkAbout);
  const showUrl = normalizeSpotifyShowUrl(talkAbout?.url);
  if (spotify && talkAbout && showUrl) {
    try {
      const episodeUrl = await resolveLatestSpotifyTalkAboutEpisode(env, showUrl, { now });
      if (episodeUrl && normalizeSpotifyEpisodeUrl(talkAbout.episodeUrl) !== episodeUrl) {
        talkAbout.episodeUrl = episodeUrl;
        changed = true;
      }
    } catch (error) {
      console.warn("spotify-talkabout-latest-resolve-failed", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!changed) return snapshot;
  const payload = JSON.stringify(config);
  if (payload.length > 32_000) {
    console.warn("spotify-talkabout-config-update-skipped", {
      deviceId,
      reason: "config-too-large",
    });
    return snapshot;
  }

  const nextVersion = snapshot.config_version + 1;
  const updated = await env.DB.prepare(
    `UPDATE device_configs
        SET version=?2,payload=?3,updated_at=?4
      WHERE device_id=?1 AND version=?5`,
  ).bind(deviceId, nextVersion, payload, now, snapshot.config_version).run();
  if (Number(updated.meta.changes ?? 0) !== 1) {
    // An admin save won the race. Never overwrite it; the next device sync will
    // resolve the latest episode against that newer configuration.
    return snapshot;
  }

  return {
    ...snapshot,
    config_version: nextVersion,
    config_updated_at: now,
    config_payload: payload,
  };
}

function preferredEnvironmentState(
  manifest: DeviceSyncManifestRow,
  r2: StateRow | null,
): StateRow | null {
  if (!r2) return null;
  const d1FetchedAt = Number(manifest.environment_fetched_at ?? 0);
  return r2.fetched_at >= d1FetchedAt ? r2 : null;
}

export async function buildDeviceSyncPayloadForDevice(
  env: Env,
  deviceId: string,
  clientVersions: Record<string, unknown>,
  manifestOverride?: DeviceSyncManifestRow,
): Promise<Record<string, unknown>> {
  if (!deviceId) throw new Error("valid deviceId is required");
  const requested = {
    dashboard: requestedVersion(clientVersions.dashboard),
    radar: requestedVersion(clientVersions.radar),
    switchbot: requestedVersion(clientVersions.switchbot),
    stationhead: optionalRequestedVersion(clientVersions.stationhead),
    stationheadHealth: optionalRequestedVersion(clientVersions.stationheadHealth),
    config: requestedVersion(clientVersions.config),
  };
  const now = Date.now();
  const [manifest, initialSnapshot, r2Environment] = await Promise.all([
    manifestOverride ? Promise.resolve(manifestOverride) : readDeviceSyncManifest(env),
    deviceSpecificSnapshot(env, deviceId, now),
    readR2EnvironmentState(env),
  ]);
  const snapshot = await refreshManagedSpotifyConfig(
    env, deviceId, initialSnapshot, now,
  );
  const versions = normalizeDeviceSyncVersions(manifest);
  const environmentState = preferredEnvironmentState(manifest, r2Environment);
  const d1EnvironmentVersion = Number(manifest.environment_version ?? 0);
  const environmentVersion = environmentState?.version ?? d1EnvironmentVersion;
  const currentDashboardVersion = Math.max(
    0,
    versions.dashboard_version - d1EnvironmentVersion + environmentVersion,
  );
  const radarVersion = versions.radar_version;
  const switchbotVersion = versions.switchbot_version;
  const stationheadVersion = versions.stationhead_version;
  const stationheadHealthVersion = versions.stationhead_health_version;
  const configVersion = Number(snapshot.config_version ?? 0);
  const configUpdatedAt = Number(snapshot.config_updated_at ?? 0);
  const commands = Number(snapshot.pending) === 1
    ? await claimPendingDeviceCommands(env, deviceId, now)
    : [];
  const response: Record<string, unknown> = {
    workerVersion: WORKER_VERSION,
    versions: {
      dashboard: currentDashboardVersion,
      radar: radarVersion,
      switchbot: switchbotVersion,
      stationhead: stationheadVersion,
      stationheadHealth: stationheadHealthVersion,
      config: configVersion,
    },
    commands,
  };

  const dashboardChanged = currentDashboardVersion !== requested.dashboard;
  const payloadSources = new Set<SyncSourceName>();
  if (dashboardChanged) for (const source of DASHBOARD_SOURCE_NAMES) payloadSources.add(source);
  if (radarVersion !== requested.radar) payloadSources.add("radar");
  if (switchbotVersion !== requested.switchbot) payloadSources.add("switchbot");
  if (requested.stationhead !== null &&
      stationheadVersion !== requested.stationhead) {
    payloadSources.add("stationhead");
  }
  if (requested.stationheadHealth !== null &&
      stationheadHealthVersion !== requested.stationheadHealth) {
    payloadSources.add("stationhead_health");
  }

  const states: Record<string, StateRow> = {};
  if (payloadSources.size) {
    const names = [...payloadSources];
    const placeholders = names.map(() => "?").join(",");
    const stateResult = await env.DB.prepare(
      `SELECT source,version,payload,observed_at,fetched_at,last_success_at,status,error,content_hash
         FROM current_state WHERE source IN (${placeholders})`,
    ).bind(...names).all<StateRow>();
    for (const state of stateResult.results ?? []) states[state.source] = state;
    if (dashboardChanged && environmentState) states.environment = environmentState;
  }

  if (dashboardChanged) response.dashboard = JSON.stringify(dashboardPayload(states));
  const radarState = states.radar;
  if (radarState && radarVersion !== requested.radar) response.radar = radarState.payload;
  const switchbotState = states.switchbot;
  if (switchbotState && switchbotVersion !== requested.switchbot) response.switchbot = switchbotState.payload;
  const stationheadState = states.stationhead;
  if (stationheadState && requested.stationhead !== null &&
      stationheadVersion !== requested.stationhead) {
    response.stationhead = stationheadState.payload;
  }
  const stationheadHealthState = states.stationhead_health;
  if (stationheadHealthState && requested.stationheadHealth !== null &&
      stationheadHealthVersion !== requested.stationheadHealth) {
    response.stationheadHealth = JSON.stringify(stationheadHealthPayload(stationheadHealthState));
  }

  if (configVersion !== requested.config) {
    let value: unknown = {};
    try { value = snapshot.config_payload ? JSON.parse(snapshot.config_payload) : {}; } catch { value = {}; }
    response.deviceConfig = JSON.stringify({
      deviceId,
      version: configVersion,
      updatedAt: configUpdatedAt,
      config: value,
    });
  }
  return response;
}

export async function buildDeviceSyncPayload(request: Request, env: Env): Promise<Record<string, unknown>> {
  const deviceId = deviceIdFrom(request);
  if (!deviceId) throw new Error("valid deviceId is required");
  const params = new URL(request.url).searchParams;
  return buildDeviceSyncPayloadForDevice(env, deviceId, {
    dashboard: params.get("dashboardVersion"),
    radar: params.get("radarVersion"),
    switchbot: params.get("switchbotVersion"),
    stationhead: params.has("stationheadVersion") ? params.get("stationheadVersion") : null,
    stationheadHealth: params.has("stationheadHealthVersion")
      ? params.get("stationheadHealthVersion")
      : null,
    config: params.get("configVersion"),
  });
}

export async function getDeviceSync(request: Request, env: Env): Promise<Response> {
  const deviceId = deviceIdFrom(request);
  if (!deviceId) return json({ error: "valid deviceId is required" }, { status: 400 });
  return json(await buildDeviceSyncPayload(request, env));
}
