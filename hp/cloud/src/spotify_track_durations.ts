import type { Env } from "./sources";

const SPOTIFY_API_ORIGIN = "https://api.spotify.com";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const TRACK_CACHE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONCURRENCY = 4;

type FetchLike = typeof fetch;

type ResolverDependencies = {
  fetchImpl?: FetchLike;
  now?: number;
  concurrency?: number;
};

type CachedDuration = {
  durationMs: number;
  expiresAt: number;
};

let cachedClientToken = "";
let cachedClientTokenKey = "";
let cachedClientTokenExpiresAt = 0;
const durationCache = new Map<string, CachedDuration>();

function clientCredentialsConfigured(env: Env): boolean {
  return Boolean(env.SPOTIFY_CLIENT_ID?.trim() && env.SPOTIFY_CLIENT_SECRET?.trim());
}

async function spotifyClientToken(
  env: Env,
  fetchImpl: FetchLike,
  now: number,
): Promise<string> {
  if (!clientCredentialsConfigured(env)) return "";
  const clientId = env.SPOTIFY_CLIENT_ID!.trim();
  const clientSecret = env.SPOTIFY_CLIENT_SECRET!.trim();
  const key = `${clientId}\u0000${clientSecret}`;
  if (cachedClientToken && cachedClientTokenKey === key && now < cachedClientTokenExpiresAt) {
    return cachedClientToken;
  }

  const response = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!response.ok) throw new Error(`Spotify client token HTTP ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const token = String(payload.access_token ?? "").trim();
  if (!token) throw new Error("Spotify client token missing access_token");
  const expiresInSeconds = Math.max(60, Number(payload.expires_in ?? 3600) || 3600);
  cachedClientToken = token;
  cachedClientTokenKey = key;
  cachedClientTokenExpiresAt = now + Math.max(60_000, expiresInSeconds * 1000 - 60_000);
  return token;
}

function normalizeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(value => String(value ?? "").trim()))]
    .filter(id => SPOTIFY_ID_PATTERN.test(id));
}

async function fetchTrackDuration(
  spotifyId: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<number> {
  const url = new URL(`${SPOTIFY_API_ORIGIN}/v1/tracks/${spotifyId}`);
  url.searchParams.set("market", "JP");
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Spotify track ${spotifyId} HTTP ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const durationMs = Math.round(Number(payload.duration_ms ?? 0));
  return Number.isSafeInteger(durationMs) && durationMs >= 1_000 && durationMs <= 24 * 60 * 60 * 1000
    ? durationMs
    : 0;
}

export async function resolveSpotifyTrackDurations(
  env: Env,
  spotifyIds: readonly string[],
  dependencies: ResolverDependencies = {},
): Promise<Map<string, number>> {
  const ids = normalizeIds(spotifyIds);
  const resolved = new Map<string, number>();
  if (!ids.length) return resolved;

  const now = dependencies.now ?? Date.now();
  const missing: string[] = [];
  for (const id of ids) {
    const cached = durationCache.get(id);
    if (cached && cached.expiresAt > now) resolved.set(id, cached.durationMs);
    else missing.push(id);
  }
  if (!missing.length) return resolved;

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const token = await spotifyClientToken(env, fetchImpl, now);
  if (!token) return resolved;

  let cursor = 0;
  const concurrency = Math.max(
    1,
    Math.min(Math.trunc(dependencies.concurrency ?? DEFAULT_CONCURRENCY), missing.length),
  );
  const worker = async () => {
    while (cursor < missing.length) {
      const id = missing[cursor++];
      try {
        const durationMs = await fetchTrackDuration(id, token, fetchImpl);
        if (!durationMs) continue;
        resolved.set(id, durationMs);
        durationCache.set(id, { durationMs, expiresAt: now + TRACK_CACHE_MS });
      } catch {
        // Keep the last duration persisted in device config when Spotify is
        // temporarily unavailable. Missing values are retried on a later sync.
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return resolved;
}
