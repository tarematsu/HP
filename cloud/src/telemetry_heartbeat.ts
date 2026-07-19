import type { Env } from "./sources";

export interface TelemetryHeartbeatReceipt {
  last_sequence: number;
}

export function telemetryHeartbeatReturningStatement(
  env: Env,
  deviceId: string,
  now: number,
  appVersion: string | null,
  stationheadOk: number,
  outboxCount: number,
  lastSequence: number,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO device_heartbeats(
       device_id,last_seen_at,app_version,stationhead_ok,outbox_count,payload,last_sequence
     ) VALUES(?1,?2,?3,?4,?5,NULL,?6)
     ON CONFLICT(device_id) DO UPDATE SET
       last_seen_at=excluded.last_seen_at,
       app_version=excluded.app_version,
       stationhead_ok=excluded.stationhead_ok,
       outbox_count=excluded.outbox_count,
       payload=NULL,
       last_sequence=MAX(device_heartbeats.last_sequence,excluded.last_sequence)
     RETURNING last_sequence`,
  ).bind(deviceId, now, appVersion, stationheadOk, outboxCount, lastSequence);
}
