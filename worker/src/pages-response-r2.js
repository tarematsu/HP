const R2_RESPONSE_KEY_PREFIX = 'pages-response/v1/';
const ACTIONS_RESPONSE_KEY_PREFIX = 'pages-response/actions-v2/';
const TRACK_HISTORY_MODEL_KEY = 'track-history';
const TRACK_HISTORY_STATUS_MODEL_KEY = 'track-history-status';
const FOLLOWERS_MODEL_KEY = 'followers';
const FOLLOWER_HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
const FOLLOWER_EXCLUDED_HANDLES = new Set(['46fm', 'buddy46']);

function normalizedModelKey(value) {
  const key = String(value || '').trim();
  return key && key.length <= 256 ? key : null;
}

function normalizedFollowerHandle(value) {
  return String(value || '').trim().toLowerCase();
}

function hexModelKey(value) {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function pagesR2ResponseKey(modelKey) {
  const key = normalizedModelKey(modelKey);
  return key ? `${R2_RESPONSE_KEY_PREFIX}${encodeURIComponent(key)}.json` : null;
}

export function pagesActionsR2ResponseKey(modelKey) {
  const key = normalizedModelKey(modelKey);
  return key ? `${ACTIONS_RESPONSE_KEY_PREFIX}${hexModelKey(key)}.json` : null;
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function freshEnough(updatedAt, now, maximumAgeMs) {
  const maximumAge = Number(maximumAgeMs);
  if (!Number.isFinite(updatedAt) || updatedAt < 0) return false;
  return !(Number.isFinite(maximumAge) && maximumAge >= 0 && now - updatedAt > maximumAge);
}

function emptyFollowersResponse(now) {
  const updatedAt = Number(now) || Date.now();
  return new Response(JSON.stringify({
    ok: true,
    updated_at: updatedAt,
    latest_date: null,
    handles: FOLLOWER_HANDLES,
    rows: [],
    accounts: FOLLOWER_HANDLES.map((handle) => ({
      handle,
      followers: null,
      previous_day_delta: null,
      previous_week_delta: null,
    })),
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30, s-maxage=60',
      'x-api-source': 'worker-r2-empty',
      'x-materialized-at': String(updatedAt),
      'x-materialized-cadence-seconds': '60',
    },
  });
}

function sanitizeFollowersPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const handles = Array.isArray(payload.handles)
    ? payload.handles.filter((handle) => !FOLLOWER_EXCLUDED_HANDLES.has(normalizedFollowerHandle(handle)))
    : payload.handles;
  const accounts = Array.isArray(payload.accounts)
    ? payload.accounts.filter((row) => !FOLLOWER_EXCLUDED_HANDLES.has(normalizedFollowerHandle(row?.handle)))
    : payload.accounts;
  const rows = Array.isArray(payload.rows)
    ? payload.rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const next = { ...row };
      for (const handle of FOLLOWER_EXCLUDED_HANDLES) delete next[handle];
      return next;
    })
    : payload.rows;
  const memberships = objectOrNull(payload.memberships);
  let sanitizedMemberships = memberships ?? undefined;
  if (memberships) {
    sanitizedMemberships = { ...memberships };
    for (const handle of FOLLOWER_EXCLUDED_HANDLES) delete sanitizedMemberships[handle];
  }
  return {
    ...payload,
    ...(handles === undefined ? {} : { handles }),
    ...(accounts === undefined ? {} : { accounts }),
    ...(rows === undefined ? {} : { rows }),
    ...(sanitizedMemberships === undefined ? {} : { memberships: sanitizedMemberships }),
  };
}

async function sanitizeFollowersResponse(response) {
  if (!response) return response;
  try {
    const payload = await response.clone().json();
    return new Response(JSON.stringify(sanitizeFollowersPayload(payload)), {
      status: response.status,
      headers: response.headers,
    });
  } catch {
    return response;
  }
}

export async function saveMaterializedR2Response(
  r2,
  modelKey,
  body,
  status,
  headers,
  now,
  cadenceSeconds,
) {
  const key = pagesR2ResponseKey(modelKey);
  if (!key || typeof r2?.put !== 'function') return null;
  await r2.put(key, body, {
    httpMetadata: {
      contentType: headers?.['content-type'] || 'application/json; charset=utf-8',
    },
    customMetadata: {
      version: '1',
      status: String(Number(status) || 200),
      headers_json: JSON.stringify(headers || {}),
      updated_at: String(Number(now) || Date.now()),
      cadence_seconds: String(Math.max(0, Number(cadenceSeconds) || 0)),
    },
  });
  return { bytes: body.length, chunks: 1, storage: 'r2', object_key: key };
}

export async function saveMaterializedActionsR2Response(r2, modelKey, body, status, headers, now, cadenceSeconds) {
  const key = pagesActionsR2ResponseKey(modelKey);
  if (!key || typeof r2?.put !== 'function') return null;
  const envelope = JSON.stringify({
    version: 1, updated_at: Number(now) || Date.now(),
    cadence_seconds: Math.max(0, Number(cadenceSeconds) || 0),
    status: Number(status) || 200, headers: headers || {}, body,
  });
  await r2.put(key, envelope, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return { bytes: body.length, chunks: 1, storage: 'r2', object_key: key };
}

async function responseFromActionsObject(object, now, maximumAgeMs) {
  if (!object?.body) return null;
  let envelope;
  try {
    envelope = await object.json();
  } catch {
    return null;
  }
  if (Number(envelope?.version) !== 1) return null;
  const updatedAt = Number(envelope?.updated_at);
  if (!freshEnough(updatedAt, now, maximumAgeMs)) return null;
  const headers = new Headers(objectOrNull(envelope?.headers) || {});
  headers.set('x-api-source', 'actions-r2');
  headers.set('x-materialized-at', String(updatedAt));
  const cadence = Number(envelope?.cadence_seconds);
  if (Number.isFinite(cadence) && cadence > 0) {
    headers.set('x-materialized-cadence-seconds', String(Math.trunc(cadence)));
  }
  return new Response(String(envelope?.body || ''), {
    status: Number(envelope?.status) || 200,
    headers,
  });
}

async function loadActionsEnvelope(r2, modelKey, now, maximumAgeMs) {
  const key = pagesActionsR2ResponseKey(modelKey);
  if (!key || typeof r2?.get !== 'function') return null;
  return responseFromActionsObject(await r2.get(key), now, maximumAgeMs);
}

async function loadWorkerR2Response(r2, modelKey, now, maximumAgeMs) {
  const key = pagesR2ResponseKey(modelKey);
  if (!key || typeof r2?.get !== 'function') return null;
  const object = await r2.get(key);
  if (!object?.body) return null;
  const metadata = objectOrNull(object.customMetadata) || {};
  if (Number(metadata.version) !== 1) return null;
  const updatedAt = Number(metadata.updated_at);
  if (!freshEnough(updatedAt, now, maximumAgeMs)) return null;

  let persistedHeaders = {};
  try {
    persistedHeaders = JSON.parse(metadata.headers_json || '{}');
  } catch {
    persistedHeaders = {};
  }
  const headers = new Headers(objectOrNull(persistedHeaders) || {});
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  headers.set('x-api-source', 'worker-r2');
  headers.set('x-materialized-at', String(updatedAt));
  const cadence = Number(metadata.cadence_seconds);
  if (Number.isFinite(cadence) && cadence > 0) {
    headers.set('x-materialized-cadence-seconds', String(Math.trunc(cadence)));
  }
  return new Response(object.body, {
    status: Number(metadata.status) || 200,
    headers,
  });
}

export async function loadMaterializedR2Response(
  r2,
  modelKey,
  now = Date.now(),
  maximumAgeMs = Number.MAX_SAFE_INTEGER,
) {
  // Actions owns the general materialized API variants. Track history stays
  // Worker-owned; followers prefer Actions because Stationhead blocks Worker egress.
  if (modelKey === TRACK_HISTORY_STATUS_MODEL_KEY) {
    return (await loadActionsEnvelope(r2, modelKey, now, maximumAgeMs))
      || loadWorkerR2Response(r2, modelKey, now, maximumAgeMs);
  }
  if (modelKey === TRACK_HISTORY_MODEL_KEY) {
    return loadWorkerR2Response(r2, modelKey, now, maximumAgeMs);
  }
  if (modelKey === FOLLOWERS_MODEL_KEY) {
    return sanitizeFollowersResponse(
      (await loadActionsEnvelope(r2, modelKey, now, maximumAgeMs))
        || (await loadWorkerR2Response(r2, modelKey, now, maximumAgeMs))
        || emptyFollowersResponse(now),
    );
  }
  return loadActionsEnvelope(r2, modelKey, now, maximumAgeMs);
}
