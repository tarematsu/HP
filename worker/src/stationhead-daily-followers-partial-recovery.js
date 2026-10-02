import {
  STATIONHEAD_DAILY_FOLLOWER_HANDLES,
  discoverStationheadFollowerTargets,
  fetchStationheadFollowerProfile,
  jstDateKey,
  loadBuddiesFollowerSession,
  publishFollowerReadModel,
} from './stationhead-daily-followers.js';

function normalizedHandle(value) {
  return String(value || '').trim().toLowerCase();
}

function orderedUniqueHandles(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const handle = normalizedHandle(value);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    result.push(handle);
  }
  return result;
}

// Best-effort recovery for a daily collection attempt that already failed.
// It intentionally publishes only to the R2 read model and never creates the
// daily D1 completion row. That keeps the normal resilient retry path active
// until every fixed account can be collected successfully.
export async function collectStationheadPartialFollowerRecovery(
  env,
  scheduledAt = Date.now(),
  dependencies = {},
) {
  if (typeof env?.PAGES_RESPONSE_R2?.get !== 'function'
      || typeof env?.PAGES_RESPONSE_R2?.put !== 'function') {
    throw new Error('PAGES_RESPONSE_R2 binding is unavailable');
  }

  const observedAt = Number(scheduledAt);
  if (!Number.isFinite(observedAt)) throw new Error('scheduled timestamp is invalid');

  const loadSession = dependencies.loadSession || loadBuddiesFollowerSession;
  const discoverTargets = dependencies.discoverTargets || discoverStationheadFollowerTargets;
  const fetchProfile = dependencies.fetchProfile || fetchStationheadFollowerProfile;
  const fetchFn = dependencies.fetchFn || globalThis.fetch;
  const timeoutMs = dependencies.timeoutMs;
  const now = dependencies.now || Date.now;

  const [session, targetState] = await Promise.all([
    loadSession(env),
    discoverTargets(env, observedAt),
  ]);
  const handles = orderedUniqueHandles(
    targetState?.handles?.length ? targetState.handles : STATIONHEAD_DAILY_FOLLOWER_HANDLES,
  );

  const settled = await Promise.allSettled(handles.map((handle) => fetchProfile(handle, {
    fetchFn,
    timeoutMs,
    session,
    appVersion: env?.SH_APP_VERSION,
  })));

  const profiles = [];
  const failures = [];
  settled.forEach((result, index) => {
    const handle = handles[index];
    if (result.status === 'fulfilled') profiles.push(result.value);
    else failures.push({
      handle,
      error: String(result.reason?.message || result.reason).slice(0, 300),
    });
  });

  if (!profiles.length) {
    throw new Error(`Stationhead partial follower recovery produced no profiles: ${failures.map(({ handle }) => handle).join(',')}`);
  }

  const followers = Object.fromEntries(profiles.map((profile) => [profile.handle, profile.followers]));
  const criticalFailures = failures.filter(({ handle }) => STATIONHEAD_DAILY_FOLLOWER_HANDLES.includes(handle));
  const date = jstDateKey(observedAt);
  const collectedAt = Number(now()) || Date.now();
  const historyRows = await publishFollowerReadModel(
    env.PAGES_RESPONSE_R2,
    date,
    handles,
    followers,
    collectedAt,
    failures,
    targetState?.source_masks || {},
  );

  return {
    observed_date_jst: date,
    scheduled_at: observedAt,
    collected_at: collectedAt,
    partial: true,
    handles,
    followers,
    failures,
    critical_failures: criticalFailures,
    history_rows: historyRows,
    http_requests: handles.length,
    http_successes: profiles.length,
    http_failures: failures.length,
    d1_completion_rows_written: 0,
    r2_reads: 1,
    r2_writes: 1,
  };
}
