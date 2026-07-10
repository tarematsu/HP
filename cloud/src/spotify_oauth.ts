import { DEVICE_ID_PATTERN } from "./auth";
import type { Env } from "./sources";

const SESSION_TTL_MS = 10 * 60 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;
const SCOPES = "user-read-playback-state";
const REQUIRED_SPOTIFY_KEYS = [
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REDIRECT_URI",
  "SPOTIFY_TOKEN_ENCRYPTION_KEY",
] as const satisfies readonly (keyof Env)[];

function b64url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function deviceId(request: Request, env: Env): string {
  const supplied = request.headers.get("X-HomePanel-Device-Id")?.trim()
    || env.HOMEPANEL_PRIMARY_DEVICE_ID?.trim()
    || "primary";
  if (!DEVICE_ID_PATTERN.test(supplied)) throw new Error("invalid device id");
  return supplied;
}

function required(env: Env, key: keyof Env): string {
  const value = String(env[key] ?? "").trim();
  if (!value) throw new Error(`${String(key)} is not configured`);
  return value;
}

function safeErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function oauthError(
  status: number,
  stage: string,
  error: string,
  detail?: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({
    error,
    stage,
    detail: detail || undefined,
    ...extra,
  }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function validateSpotifyConfiguration(env: Env): Response | null {
  const missing = REQUIRED_SPOTIFY_KEYS
    .filter(key => !String(env[key] ?? "").trim())
    .map(String);
  if (missing.length) {
    return oauthError(503, "configuration", "spotify_configuration_missing", undefined, { missing });
  }

  const redirectUri = String(env.SPOTIFY_REDIRECT_URI).trim();
  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== "https:" || parsed.pathname !== "/v1/spotify/callback") {
      return oauthError(503, "redirect_uri_validation", "spotify_redirect_uri_invalid",
        "Redirect URI must use HTTPS and end with /v1/spotify/callback.", { redirectUri });
    }
  } catch (error) {
    return oauthError(503, "redirect_uri_validation", "spotify_redirect_uri_invalid",
      safeErrorDetail(error), { redirectUri });
  }
  return null;
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const secret = required(env, "SPOTIFY_TOKEN_ENCRYPTION_KEY");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptToken(token: string, env: Env): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(env),
    new TextEncoder().encode(token),
  ));
  return `${b64url(iv)}.${b64url(encrypted)}`;
}

function decodeB64url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const decoded = atob(padded);
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function decryptToken(value: string, env: Env): Promise<string> {
  const [ivPart, payloadPart] = value.split(".");
  if (!ivPart || !payloadPart) throw new Error("invalid encrypted token");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeB64url(ivPart) },
    await encryptionKey(env),
    decodeB64url(payloadPart),
  );
  return new TextDecoder().decode(plain);
}

function callbackUrl(env: Env): string {
  return required(env, "SPOTIFY_REDIRECT_URI");
}

function spotifyAuthHeader(env: Env): string {
  return `Basic ${btoa(`${required(env, "SPOTIFY_CLIENT_ID")}:${required(env, "SPOTIFY_CLIENT_SECRET")}`)}`;
}

async function tokenRequest(env: Env, body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: spotifyAuthHeader(env),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Spotify token HTTP ${response.status}`);
  return payload;
}

export async function startSpotifyAuthorization(request: Request, env: Env): Promise<Response> {
  const configurationError = validateSpotifyConfiguration(env);
  if (configurationError) return configurationError;

  let id: string;
  try {
    id = deviceId(request, env);
  } catch (error) {
    return oauthError(400, "device_id_validation", "spotify_device_id_invalid", safeErrorDetail(error));
  }

  const state = randomToken();
  const now = Date.now();
  try {
    await env.DB.prepare(
      "INSERT INTO spotify_oauth_sessions(state, device_id, expires_at, created_at) VALUES(?, ?, ?, ?)",
    ).bind(state, id, now + SESSION_TTL_MS, now).run();
  } catch (error) {
    return oauthError(500, "d1_session_insert", "spotify_oauth_session_insert_failed",
      safeErrorDetail(error), { migration: "0099_spotify_oauth.sql" });
  }

  let cleanupWarning: string | undefined;
  try {
    await env.DB.prepare("DELETE FROM spotify_oauth_sessions WHERE expires_at < ?").bind(now).run();
  } catch (error) {
    cleanupWarning = safeErrorDetail(error);
    console.warn("Spotify OAuth expired-session cleanup failed", cleanupWarning);
  }

  const redirectUri = callbackUrl(env);
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", required(env, "SPOTIFY_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("show_dialog", "true");
  return Response.json({
    authorizationUrl: url.toString(),
    redirectUri,
    expiresAt: now + SESSION_TTL_MS,
    stage: "authorization_url_ready",
    cleanupWarning,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function spotifyCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const error = url.searchParams.get("error") ?? "";
  const now = Date.now();
  const session = await env.DB.prepare(
    "SELECT device_id, expires_at FROM spotify_oauth_sessions WHERE state = ?",
  ).bind(state).first<{ device_id: string; expires_at: number }>();
  await env.DB.prepare("DELETE FROM spotify_oauth_sessions WHERE state = ?").bind(state).run();

  if (!session || session.expires_at < now || error || !code) {
    return new Response("<!doctype html><meta charset=utf-8><h1>Spotify authentication failed</h1><p>You may close this tab.</p>", {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const token = await tokenRequest(env, new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(env),
  }));
  const refreshToken = String(token.refresh_token ?? "");
  const accessToken = String(token.access_token ?? "");
  if (!refreshToken || !accessToken) throw new Error("Spotify did not return required tokens");
  const expiresAt = now + Number(token.expires_in ?? 3600) * 1000;
  await env.DB.prepare(
    `INSERT INTO spotify_credentials(device_id, encrypted_refresh_token, access_token, access_expires_at, scope, updated_at, revoked_at)
     VALUES(?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(device_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token,
       access_token=excluded.access_token, access_expires_at=excluded.access_expires_at,
       scope=excluded.scope, updated_at=excluded.updated_at, revoked_at=NULL`,
  ).bind(session.device_id, await encryptToken(refreshToken, env), accessToken, expiresAt, String(token.scope ?? SCOPES), now).run();

  return new Response("<!doctype html><meta charset=utf-8><h1>Spotify authentication completed</h1><p>HomePanel can now read playback information. You may close this tab.</p>", {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function spotifyStatus(request: Request, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT updated_at, revoked_at FROM spotify_credentials WHERE device_id = ?",
  ).bind(deviceId(request, env)).first<{ updated_at: number; revoked_at: number | null }>();
  return Response.json({ connected: Boolean(row && row.revoked_at === null), updatedAt: row?.updated_at ?? null }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function spotifyAccessToken(request: Request, env: Env): Promise<Response> {
  const id = deviceId(request, env);
  const row = await env.DB.prepare(
    "SELECT encrypted_refresh_token, access_token, access_expires_at, revoked_at FROM spotify_credentials WHERE device_id = ?",
  ).bind(id).first<{ encrypted_refresh_token: string; access_token: string | null; access_expires_at: number; revoked_at: number | null }>();
  if (!row || row.revoked_at !== null) return Response.json({ error: "authorization_required" }, { status: 404 });
  const now = Date.now();
  if (row.access_token && row.access_expires_at > now + TOKEN_SKEW_MS) {
    return Response.json({ accessToken: row.access_token, expiresAt: row.access_expires_at }, { headers: { "Cache-Control": "no-store" } });
  }

  const token = await tokenRequest(env, new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: await decryptToken(row.encrypted_refresh_token, env),
  }));
  const accessToken = String(token.access_token ?? "");
  if (!accessToken) throw new Error("Spotify refresh did not return an access token");
  const expiresAt = now + Number(token.expires_in ?? 3600) * 1000;
  const replacement = String(token.refresh_token ?? "");
  const encrypted = replacement ? await encryptToken(replacement, env) : row.encrypted_refresh_token;
  await env.DB.prepare(
    "UPDATE spotify_credentials SET encrypted_refresh_token=?, access_token=?, access_expires_at=?, updated_at=? WHERE device_id=?",
  ).bind(encrypted, accessToken, expiresAt, now, id).run();
  return Response.json({ accessToken, expiresAt }, { headers: { "Cache-Control": "no-store" } });
}
