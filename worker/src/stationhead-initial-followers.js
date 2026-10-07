import { requireStationheadSourceProfile } from '../../packages/sh-shared/stationhead-source.mjs';
import { pagesR2ResponseKey } from './pages-response-r2.js';
import {
  fetchStationheadFollowerProfile,
  jstDateKey,
  publishFollowerReadModel,
} from './stationhead-daily-followers.js';
import { STATIONHEAD_FOLLOWER_SOURCE } from './stationhead-follower-membership.js';
import { registerStationheadFollowerTarget } from './stationhead-follower-target.js';

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
    const hot = await env.PAGES_RESPONSE_R2.get(requireStationheadSourceProfile('ohisama').collectorStateHotKey);
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
    { [handle]: options.sourceMask || STATIONHEAD_FOLLOWER_SOURCE.ohisama });
  return true;
}

export async function registerBuddiesInitialFollowerTarget(env, snapshot, observedAt, session) {
  const handle = String(snapshot?.host_handle || '').trim().toLowerCase();
  if (snapshot?.is_broadcasting !== 1 || !handle || !env?.PAGES_RESPONSE_R2) return false;
  const targetAdded = await registerStationheadFollowerTarget(
    env,
    snapshot,
    observedAt,
    STATIONHEAD_FOLLOWER_SOURCE.buddies,
  );

  // The R2 marker only suppresses the optional initial sample. Live target
  // confirmation must still run on every broadcast so historical discoveries
  // stay ineligible until a broadcaster is actually observed on air.
  const key = `stationhead/buddies/follower-initial/${encodeURIComponent(handle)}.json`;
  if (await env.PAGES_RESPONSE_R2.get(key)) return targetAdded;
  await collectInitialStationheadFollowers(env, handle, observedAt, {
    session,
    sourceMask: STATIONHEAD_FOLLOWER_SOURCE.buddies,
  });
  await env.PAGES_RESPONSE_R2.put(key, JSON.stringify({ observed_at: observedAt }));
  return targetAdded;
}
