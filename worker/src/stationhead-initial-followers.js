import { pagesR2ResponseKey } from './pages-response-r2.js';
import {
  fetchStationheadFollowerProfile,
  jstDateKey,
  publishFollowerReadModel,
} from './stationhead-daily-followers.js';

// Initial samples live in the R2 history. They must not create the daily D1
// completion row, which would suppress the next midnight retry.
export async function collectInitialStationheadFollowers(env, handleValue, observedAt, options = {}) {
  const handle = String(handleValue || '').trim().toLowerCase();
  if (!handle || !env?.PAGES_RESPONSE_R2?.get || !env?.OTHER_DB?.prepare) return false;
  const object = await env.PAGES_RESPONSE_R2.get(pagesR2ResponseKey('followers'));
  const model = object ? await object.json() : null;
  if (model?.rows?.some((row) => Object.hasOwn(row, handle)
    && Number.isInteger(row[handle]) && row[handle] >= 0)) return false;

  let session = options.session;
  if (!session) {
    const hot = await env.PAGES_RESPONSE_R2.get('stationhead/ohisama/collector-state.json');
    const state = hot ? await hot.json() : null;
    session = { auth_token: state?.authToken, device_uid: state?.deviceUid };
  }
  const profile = await (options.fetchProfile || fetchStationheadFollowerProfile)(handle, {
    session,
    fetchFn: options.fetchFn,
    appVersion: env.SH_APP_VERSION,
  });
  await publishFollowerReadModel(env.PAGES_RESPONSE_R2, jstDateKey(observedAt), [handle],
    { [handle]: profile.followers }, observedAt, model?.failures || [],
    { [handle]: options.sourceMask || 4 });
  return true;
}

export async function registerBuddiesInitialFollowerTarget(env, snapshot, observedAt, session) {
  const handle = String(snapshot?.host_handle || '').trim().toLowerCase();
  if (snapshot?.is_broadcasting !== 1 || !handle || !env?.OTHER_DB?.prepare || !env?.PAGES_RESPONSE_R2) return false;
  const result = await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_follower_targets(handle,source_mask,first_seen_at)
    VALUES(?,2,?) ON CONFLICT(handle) DO UPDATE SET
    source_mask=(sh_stationhead_follower_targets.source_mask | 2)
    WHERE (sh_stationhead_follower_targets.source_mask & 2)=0`).bind(handle, observedAt).run();
  const targetAdded = Number(result?.meta?.changes || 0) > 0;

  // The R2 marker only suppresses the optional initial sample. Target registration
  // must still run on every live broadcast so a cleaned registry can be rebuilt
  // exclusively from handles actually observed while broadcasting.
  const key = `stationhead/buddies/follower-initial/${encodeURIComponent(handle)}.json`;
  if (await env.PAGES_RESPONSE_R2.get(key)) return targetAdded;
  await collectInitialStationheadFollowers(env, handle, observedAt, { session, sourceMask: 2 });
  await env.PAGES_RESPONSE_R2.put(key, JSON.stringify({ observed_at: observedAt }));
  return targetAdded;
}
