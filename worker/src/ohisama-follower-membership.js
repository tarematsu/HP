import {
  pagesR2ResponseKey,
  saveMaterializedR2Response,
} from './pages-response-r2.js';

const MODEL_KEY = 'followers';
const CADENCE_SECONDS = 24 * 60 * 60;
const HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
});
const OHISAMA_MEMBERSHIP = Object.freeze({
  affiliation: 'Ohisama',
  group: 'hinatazaka46',
});

function normalizedHandle(value) {
  const handle = String(value || '').trim().toLowerCase();
  return handle && handle.length <= 128 ? handle : null;
}

async function loadFollowersPayload(r2) {
  const key = pagesR2ResponseKey(MODEL_KEY);
  if (!key || typeof r2?.get !== 'function') return null;
  const object = await r2.get(key);
  if (!object) return null;
  try {
    const payload = typeof object.json === 'function'
      ? await object.json()
      : JSON.parse(await object.text());
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function publishOhisamaFollowerMembership(env, handleValue, observedAt = Date.now()) {
  const handle = normalizedHandle(handleValue);
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!handle || typeof r2?.put !== 'function') return false;

  const existing = await loadFollowersPayload(r2) || {
    ok: true,
    latest_date: null,
    handles: [],
    rows: [],
    accounts: [],
    memberships: {},
    failures: [],
  };
  const existingHandles = Array.isArray(existing.handles) ? existing.handles : [];
  const handles = [...new Set([...existingHandles, handle])];
  const existingMemberships = existing.memberships
    && typeof existing.memberships === 'object'
    && !Array.isArray(existing.memberships)
    ? existing.memberships
    : {};
  const current = existingMemberships[handle];
  if (
    existingHandles.includes(handle)
    && current?.affiliation === OHISAMA_MEMBERSHIP.affiliation
    && current?.group === OHISAMA_MEMBERSHIP.group
  ) return false;

  const memberships = {
    ...existingMemberships,
    [handle]: OHISAMA_MEMBERSHIP,
  };
  const updatedAt = Number(observedAt) || Date.now();
  const body = JSON.stringify({
    ...existing,
    ok: true,
    updated_at: updatedAt,
    handles,
    memberships,
  });
  await saveMaterializedR2Response(
    r2,
    MODEL_KEY,
    body,
    200,
    HEADERS,
    updatedAt,
    CADENCE_SECONDS,
  );
  return true;
}

export function withOhisamaFollowerMembership(registerFollowerTarget) {
  if (typeof registerFollowerTarget !== 'function') {
    throw new TypeError('registerFollowerTarget must be a function');
  }
  return async (env, snapshot, observedAt, session) => {
    const added = await registerFollowerTarget(env, snapshot, observedAt, session);
    await publishOhisamaFollowerMembership(env, snapshot?.host_handle, observedAt).catch((error) => {
      console.warn(JSON.stringify({
        event: 'ohisama_follower_membership_publish_failed',
        handle: snapshot?.host_handle || null,
        error: String(error?.message || error).slice(0, 500),
      }));
    });
    return added;
  };
}

export default {
  publishOhisamaFollowerMembership,
  withOhisamaFollowerMembership,
};
