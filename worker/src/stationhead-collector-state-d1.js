// D1 collector-state persistence shared by Stationhead sources.
// Callers pass their own D1 binding; auth credentials and checkpoints never
// cross source/database boundaries. Keep writes scoped to existing columns.
const STATE_ID = 'stationhead';

export async function readStationheadCollectorD1State(db, stateId = STATE_ID) {
  if (typeof db?.prepare !== 'function') throw new Error('Stationhead collector D1 binding is missing');
  return db.prepare(`SELECT
      auth_token,device_uid,token_expires_at,last_run_at,last_success_at,last_error,
      last_channel_id,last_station_id,updated_at
    FROM sh_worker_collector_state WHERE id=? LIMIT 1`)
    .bind(stateId).first();
}

export function stationheadCollectorCheckpointStatement(db, state, now, stateId = STATE_ID) {
  if (typeof db?.prepare !== 'function') throw new Error('Stationhead collector D1 binding is missing');
  return db.prepare(`INSERT INTO sh_worker_collector_state(
      id,auth_token,device_uid,token_expires_at,last_run_at,last_success_at,last_error,
      last_channel_id,last_station_id,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      auth_token=excluded.auth_token,
      device_uid=excluded.device_uid,
      token_expires_at=excluded.token_expires_at,
      last_run_at=excluded.last_run_at,
      last_success_at=excluded.last_success_at,
      last_error=excluded.last_error,
      last_channel_id=excluded.last_channel_id,
      last_station_id=excluded.last_station_id,
      updated_at=excluded.updated_at`)
    .bind(
      stateId,
      state.authToken || null,
      state.deviceUid || null,
      state.tokenExpiresAt || null,
      state.lastRunAt || null,
      state.lastSuccessAt || null,
      null,
      state.lastChannelId || null,
      state.lastStationId || null,
      now,
    );
}

// Buddies refresh must not rewrite the last collector success or error fields.
export async function persistStationheadCollectorD1Credentials(db, session, now, stateId = STATE_ID) {
  if (typeof db?.prepare !== 'function') throw new Error('Stationhead collector D1 binding is missing');
  await db.prepare(`INSERT INTO sh_worker_collector_state(
      id,auth_token,device_uid,token_expires_at,updated_at
    ) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      auth_token=excluded.auth_token,device_uid=excluded.device_uid,
      token_expires_at=excluded.token_expires_at,updated_at=excluded.updated_at`)
    .bind(stateId, session.authToken, session.deviceUid, session.tokenExpiresAt, now).run();
}

export async function recordStationheadCollectorD1Failure(db, observedAt, detail, stateId = STATE_ID) {
  if (typeof db?.prepare !== 'function') throw new Error('Stationhead collector D1 binding is missing');
  await db.prepare(`INSERT INTO sh_worker_collector_state(
      id,last_run_at,last_error,updated_at
    ) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      last_run_at=excluded.last_run_at,
      last_error=excluded.last_error,
      updated_at=excluded.updated_at`)
    .bind(stateId, observedAt, detail, observedAt).run();
}
