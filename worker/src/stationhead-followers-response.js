const FOLLOWER_HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
const FOLLOWER_EXCLUDED_HANDLES = new Set(['46fm', 'buddy46']);

function normalizedFollowerHandle(value) {
  return String(value || '').trim().toLowerCase();
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
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

export function sanitizeFollowersPayload(payload) {
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

export async function normalizeFollowersResponse(response, now = Date.now()) {
  if (!response) return emptyFollowersResponse(now);
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
