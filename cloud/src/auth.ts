import { constantTimeEqual } from "./crypto_cache";
import type { Env } from "./sources";

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

const DEVICE_TOKEN_MAP_CACHE_LIMIT = 4;
const deviceTokenMapCache = new Map<string, Map<string, string>>();

function parseMappedDeviceTokens(raw: string): Map<string, string> {
  const cached = deviceTokenMapCache.get(raw);
  if (cached) return cached;
  let parsed: Map<string, string>;
  try {
    const value = JSON.parse(raw) as unknown;
    parsed = !value || typeof value !== "object" || Array.isArray(value)
      ? new Map()
      : new Map(
        Object.entries(value as Record<string, unknown>)
          .filter((entry): entry is [string, string] =>
            DEVICE_ID_PATTERN.test(entry[0]) && typeof entry[1] === "string" && entry[1].trim().length > 0)
          .map(([deviceId, token]) => [deviceId, token.trim()] as const),
      );
  } catch {
    parsed = new Map();
  }
  deviceTokenMapCache.set(raw, parsed);
  if (deviceTokenMapCache.size > DEVICE_TOKEN_MAP_CACHE_LIMIT) {
    const oldest = deviceTokenMapCache.keys().next().value as string | undefined;
    if (oldest !== undefined && oldest !== raw) deviceTokenMapCache.delete(oldest);
  }
  return parsed;
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

export function configuredDeviceTokens(env: Env): Map<string, string> | null {
  const raw = env.HOMEPANEL_DEVICE_TOKENS?.trim() ?? "";
  return raw ? parseMappedDeviceTokens(raw) : null;
}

export function deviceIdFromRequest(request: Request): string | null {
  const deviceId = new URL(request.url).searchParams.get("deviceId")?.trim() ?? "";
  return DEVICE_ID_PATTERN.test(deviceId) ? deviceId : null;
}

function matchesExpectedToken(supplied: string, expected: string | undefined): boolean {
  if (!supplied || !expected) return false;
  const normalized = expected.trim();
  return normalized.length > 0 && constantTimeEqual(supplied, normalized);
}

export function matchesAnyToken(supplied: string, expected: Array<string | undefined>): boolean {
  if (!supplied) return false;
  for (const value of expected) {
    if (matchesExpectedToken(supplied, value)) return true;
  }
  return false;
}

export function deviceSecrets(env: Env): Array<string | undefined> {
  return [env.HOMEPANEL_INGEST_SECRET, env.DEVICE_TOKEN];
}

export function actionSecrets(env: Env): Array<string | undefined> {
  return [env.API_TOKEN, env.HOMEPANEL_INGEST_SECRET, env.DEVICE_TOKEN];
}

export function authorizedAnyDevice(request: Request, env: Env): boolean {
  const supplied = bearerToken(request);
  const configured = configuredDeviceTokens(env);
  if (configured) {
    for (const expected of configured.values()) {
      if (constantTimeEqual(supplied, expected)) return true;
    }
    return false;
  }
  return matchesExpectedToken(supplied, env.HOMEPANEL_INGEST_SECRET)
    || matchesExpectedToken(supplied, env.DEVICE_TOKEN);
}

export function authorizedDevice(request: Request, env: Env, deviceId: string): boolean {
  const supplied = bearerToken(request);
  const configured = configuredDeviceTokens(env);
  if (configured) {
    const expected = configured.get(deviceId);
    return expected !== undefined && constantTimeEqual(supplied, expected);
  }
  return matchesExpectedToken(supplied, env.HOMEPANEL_INGEST_SECRET)
    || matchesExpectedToken(supplied, env.DEVICE_TOKEN);
}

export function authorizedAction(request: Request, env: Env): boolean {
  const supplied = bearerToken(request);
  return matchesExpectedToken(supplied, env.API_TOKEN)
    || matchesExpectedToken(supplied, env.HOMEPANEL_INGEST_SECRET)
    || matchesExpectedToken(supplied, env.DEVICE_TOKEN);
}
