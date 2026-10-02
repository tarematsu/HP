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
  const result = await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_follower_targets(
      handle,source_mask,first_seen_at,live_confirmed_at
    ) VALUES(?,2,?,?) ON CONFLICT(handle) DO UPDATE SET
    source_mask=(sh_stationhead_follower_targets.source_mask | 2),
    live_confirmed_at=COALESCE(sh_stationhead_follower_targets.live_confirmed_at,excluded.live_confirmed_at)
    WHERE (sh_stationhead_follower_targets.source_mask & 2)=0
       OR sh_stationhead_follower_targets.live_confirmed_at IS NULL`)
    .bind(handle, observedAt, observedAt).run();
  const targetAdded = Number(result?.meta?.changes || 0) > 0;

  // The R2 marker only suppresses the optional initial sample. Live target
  // confirmation must still run on every broadcast so historical discoveries
  // stay ineligible until a broadcaster is actually observed on air.
  const key = `stationhead/buddies/follower-initial/${encodeURIComponent(handle)}.json`;
  if (await env.PAGES_RESPONSE_R2.get(key)) return targetAdded;
  await collectInitialStationheadFollowers(env, handle, observedAt, { session, sourceMask: 2 });
  await env.PAGES_RESPONSE_R2.put(key, JSON.stringify({ observed_at: observedAt }));
  return targetAdded;
}
