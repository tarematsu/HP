import { AUTH_CONTROL_SCHEMA_SQL } from './auth-state.js';
import { claimStationheadAuthRefresh, finishStationheadAuthRefresh } from './stationhead-auth-control.js';

const AUTH_STATE_ID = 'stationhead';
const DEFAULT_AUTH_LOCK_MS = 60_000;
const DEFAULT_AUTH_COOLDOWN_MS = 5 * 60_000;
const AUTH_WAIT_ATTEMPTS = 8;
const AUTH_WAIT_INTERVAL_MS = 250;

let authControlSchemaReady = false;

function positive(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureAuthControlSchema(env) {
  if (authControlSchemaReady) return;
  if (typeof env?.OHISAMA_DB?.prepare !== 'function') {
    throw new Error('OHISAMA_DB binding is unavailable for auth refresh guard');
  }
  await env.OHISAMA_DB.prepare(AUTH_CONTROL_SCHEMA_SQL).run();
  authControlSchemaReady = true;
}

async function ensureAuthControlRow(env, now) {
  await ensureAuthControlSchema(env);
  await env.OHISAMA_DB.prepare(`INSERT OR IGNORE INTO sh_worker_auth_control(id,updated_at)
      VALUES(?,?)`)
    .bind(AUTH_STATE_ID, now)
    .run();
}

async function claimAuthRefresh(env, now) {
  const lockMs = positive(env?.AUTH_LOCK_MS, DEFAULT_AUTH_LOCK_MS);
  const cooldownMs = positive(env?.AUTH_REFRESH_COOLDOWN_MS, DEFAULT_AUTH_COOLDOWN_MS);
  await ensureAuthControlRow(env, now);
  return claimStationheadAuthRefresh(env.OHISAMA_DB, { stateId: AUTH_STATE_ID, now, lockMs, cooldownMs });
}

async function finishAuthRefresh(env, error, now) {
  await finishStationheadAuthRefresh(env.OHISAMA_DB, { stateId: AUTH_STATE_ID, now, error });
}

async function waitForPeerRefresh(readState, previousToken, dependencies = {}) {
  if (typeof readState !== 'function') return null;
  const sleepFn = dependencies.sleep || sleep;
  for (let attempt = 0; attempt < AUTH_WAIT_ATTEMPTS; attempt += 1) {
    await sleepFn(AUTH_WAIT_INTERVAL_MS);
    const state = await readState();
    if (state?.authToken && state?.deviceUid && state.authToken !== previousToken) return state;
  }
  return null;
}

export async function guardedOhisamaAuthRefresh(
  env,
  dependencies = {},
  refresh,
  readState,
  previousToken = '',
) {
  if (typeof refresh !== 'function') throw new Error('Ohisama auth refresh callback is missing');
  const nowFn = dependencies.now || Date.now;
  const now = Number(nowFn()) || Date.now();

  if (!await claimAuthRefresh(env, now)) {
    const peerState = await waitForPeerRefresh(readState, previousToken, dependencies);
    if (peerState) return peerState;
    throw new Error('Ohisama Stationhead auth refresh deferred to protect Buddies collection');
  }

  try {
    const state = await refresh();
    const finishedAt = Number(nowFn()) || Date.now();
    await finishAuthRefresh(env, null, finishedAt);
    return state;
  } catch (error) {
    const failedAt = Number(nowFn()) || Date.now();
    const message = String(error?.message || error).slice(0, 800);
    await finishAuthRefresh(env, message, failedAt).catch(() => {});
    throw error;
  }
}

export function resetOhisamaAuthRefreshGuardForTests() {
  authControlSchemaReady = false;
}
