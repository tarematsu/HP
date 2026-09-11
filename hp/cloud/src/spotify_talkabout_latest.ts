import type { Env } from "./sources";

const SPOTIFY_ORIGIN = "https://open.spotify.com";
const SPOTIFY_API_ORIGIN = "https://api.spotify.com";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const CACHE_PREFIX = "native/spotify-talkabout-latest-";
const CACHE_FRESH_MS = 20 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9]{16,32}$/;
const USER_AGENT = "HomePanel/1.0 SpotifyTalkAboutResolver";

type FetchLike = typeof fetch;

type CachedEpisode = {
  showUrl: string;
  episodeUrl: string;
  resolvedAt: number;
};

type ResolverDependencies = {
  fetchImpl?: FetchLike;
  now?: number;
};

type SpotifyEpisodeItem = {
  id?: unknown;
  release_date?: unknown;
  external_urls?: { spotify?: unknown } | null;
};

let cachedClientToken = "";
let cachedClientTokenKey = "";
let cachedClientTokenExpiresAt = 0;

function spotifyIdFromPath(value: string, kind: "show" | "episode"): string {
  try {
    const url = new URL(value, SPOTIFY_ORIGIN);
    if (url.protocol !== "https:" || url.hostname !== "open.spotify.com") return "";
    const match = url.pathname.match(new RegExp(`^/${kind}/([A-Za-z0-9]+)/*$`));
    const id = match?.[1] ?? "";
    return ID_PATTERN.test(id) ? id : "";
  } catch {
    return "";
  }
}

export function normalizeSpotifyShowUrl(value: unknown): string {
  const text = String(value ?? "").trim();
  const id = spotifyIdFromPath(text, "show");
  return id ? `${SPOTIFY_ORIGIN}/show/${id}` : "";
}

export function normalizeSpotifyEpisodeUrl(value: unknown): string {
  const text = String(value ?? "").trim();
  const id = spotifyIdFromPath(text, "episode");
  return id ? `${SPOTIFY_ORIGIN}/episode/${id}` : "";
}

function decodeSpotifyHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\\//g, "/");
}

export function extractSpotifyEpisodeUrls(value: string): string[] {
  const decoded = decodeSpotifyHtml(String(value || ""));
  const output = new Set<string>();
  const pattern = /(?:https:\/\/open\.spotify\.com)?\/episode\/[A-Za-z0-9]{16,32}/gi;
  for (const match of decoded.matchAll(pattern)) {
    const normalized = normalizeSpotifyEpisodeUrl(match[0]);
    if (normalized) output.add(normalized);
  }
  return [...output];
}

function cacheKey(showUrl: string): string {
  const id = spotifyIdFromPath(showUrl, "show");
  return `${CACHE_PREFIX}${id}.json`;
}

async function readCachedEpisode(env: Env, showUrl: string): Promise<CachedEpisode | null> {
  if (!env.DATA_BUCKET) return null;
  try {
    const object = await env.DATA_BUCKET.get(cacheKey(showUrl));
    if (!object) return null;
    const parsed = JSON.parse(await object.text()) as Partial<CachedEpisode>;
    const cachedShow = normalizeSpotifyShowUrl(parsed.showUrl);
    const episodeUrl = normalizeSpotifyEpisodeUrl(parsed.episodeUrl);
    const resolvedAt = Number(parsed.resolvedAt ?? 0);
    if (cachedShow !== showUrl || !episodeUrl || !Number.isFinite(resolvedAt) || resolvedAt <= 0) {
      return null;
    }
    return { showUrl, episodeUrl, resolvedAt };
  } catch {
    return null;
  }
}

async function writeCachedEpisode(env: Env, entry: CachedEpisode): Promise<void> {
  if (!env.DATA_BUCKET) return;
  await env.DATA_BUCKET.put(cacheKey(entry.showUrl), JSON.stringify(entry), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

function clientCredentialsConfigured(env: Env): boolean {
  return Boolean(env.SPOTIFY_CLIENT_ID?.trim() && env.SPOTIFY_CLIENT_SECRET?.trim());
}

async function spotifyClientToken(env: Env, fetchImpl: FetchLike, now: number): Promise<string> {
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

function releaseDateMillis(value: unknown): number {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function latestEpisodeFromSpotifyApi(
  env: Env,
  showUrl: string,
  fetchImpl: FetchLike,
  now: number,
): Promise<string> {
  const token = await spotifyClientToken(env, fetchImpl, now);
  if (!token) return "";
  const showId = spotifyIdFromPath(showUrl, "show");
  if (!showId) return "";

  const url = new URL(`${SPOTIFY_API_ORIGIN}/v1/shows/${showId}/episodes`);
  url.searchParams.set("market", "JP");
  url.searchParams.set("limit", "20");
  url.searchParams.set("offset", "0");
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Spotify show episodes HTTP ${response.status}`);
  const payload = await response.json() as { items?: SpotifyEpisodeItem[] };
  const candidates = (Array.isArray(payload.items) ? payload.items : [])
    .map((item, index) => {
      const external = normalizeSpotifyEpisodeUrl(item?.external_urls?.spotify);
      const id = String(item?.id ?? "").trim();
      const built = ID_PATTERN.test(id) ? `${SPOTIFY_ORIGIN}/episode/${id}` : "";
      return {
        url: external || built,
        releasedAt: releaseDateMillis(item?.release_date),
        index,
      };
    })
    .filter((item) => Boolean(item.url));
  candidates.sort((left, right) => right.releasedAt - left.releasedAt || left.index - right.index);
  return candidates[0]?.url ?? "";
}

async function latestEpisodeFromSpotifyHtml(
  showUrl: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const response = await fetchImpl(showUrl, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.7",
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`Spotify show page HTTP ${response.status}`);
  const urls = extractSpotifyEpisodeUrls(await response.text());
  return urls[0] ?? "";
}

export async function resolveLatestSpotifyTalkAboutEpisode(
  env: Env,
  configuredShowUrl: unknown,
  dependencies: ResolverDependencies = {},
): Promise<string> {
  const showUrl = normalizeSpotifyShowUrl(configuredShowUrl);
  if (!showUrl) return "";
  const now = dependencies.now ?? Date.now();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const cached = await readCachedEpisode(env, showUrl);
  if (cached && now - cached.resolvedAt <= CACHE_FRESH_MS) return cached.episodeUrl;

  let resolved = "";
  try {
    resolved = await latestEpisodeFromSpotifyApi(env, showUrl, fetchImpl, now);
  } catch {
    // Public show HTML is the credential-free fallback.
  }
  if (!resolved) {
    try {
      resolved = await latestEpisodeFromSpotifyHtml(showUrl, fetchImpl);
    } catch {
      // Preserve the last known direct episode when Spotify is temporarily unavailable.
    }
  }

  resolved = normalizeSpotifyEpisodeUrl(resolved);
  if (!resolved) return cached?.episodeUrl ?? "";
  try {
    await writeCachedEpisode(env, { showUrl, episodeUrl: resolved, resolvedAt: now });
  } catch {
    // Cache failure must not block delivery of a freshly resolved episode URL.
  }
  return resolved;
}
