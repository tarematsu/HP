import { restoreRevivedRankingStatement } from './liveness-feed-maintenance.js';
import {
  baseLivenessStatusDeltaStatement,
  deathLivenessStatusDeltaStatement
} from './liveness-status-counts.js';
import { LIVENESS_CRON } from './liveness-schedule.js';

const BASE_PHASE = 'base';
const DEATH_PHASE = 'death';
const PROBE_CONCURRENCY = 1;
const PROBE_TIMEOUT_MS = 8_000;
const LOCK_TTL_MS = 4 * 60_000;
const BASE_UPPER_ID_SQL = `(SELECT COALESCE(MAX(video.id), 0)
  FROM videos AS video
 WHERE video.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM video_blocklist AS bad
      WHERE bad.canonical_key = video.canonical_key
   )
   AND NOT EXISTS (
     SELECT 1 FROM video_death_list AS death
      WHERE death.canonical_key = video.canonical_key
   ))`;
const DEATH_UPPER_KEY_SQL = `(SELECT COALESCE(MAX(canonical_key), '')
  FROM video_death_list)`;

export const LIVENESS_BATCH_SIZE = 1;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortError(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 500);
}

export function classifyProbeStatus(status) {
  const code = Number(status);
  if ((code >= 200 && code < 400) || code === 416) return 'alive';
  if (code === 404 || code === 410) return 'dead';
  return 'unknown';
}

export function shouldRefreshAliveMetadata(row, status) {
  const previousStatus = row?.lastHttpStatus == null ? null : Number(row.lastHttpStatus);
  const nextStatus = status == null ? null : Number(status);
  return number(row?.failCount) > 0 || previousStatus !== nextStatus;
}

export async function probeVideoUrl(mediaUrl, fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('probe-timeout'), timeoutMs);
  try {
    const response = await fetchImpl(mediaUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'video/*,*/*;q=0.1',
        'cache-control': 'no-cache',
        range: 'bytes=0-0'
      }
    });
    const result = {
      state: classifyProbeStatus(response.status),
      status: response.status,
      error: null
    };
    if (response.body) await response.body.cancel().catch(() => {});
    return result;
  } catch (error) {
    return { state: 'unknown', status: null, error: shortError(error) };
  } finally {
    clearTimeout(timer);
  }
}

export function prepareLivenessStateRead(db) {
  return db.prepare(
    `SELECT phase,
            base_cursor_id AS baseCursorId,
            base_upper_id AS baseUpperId,
            death_cursor_key AS deathCursorKey,
            death_upper_key AS deathUpperKey,
            cycle, checked_total AS checkedTotal,
            dead_total AS deadTotal, revived_total AS revivedTotal,
            last_run_at AS lastRunAt,
            last_checked_count AS lastCheckedCount,
            last_dead_count AS lastDeadCount,
            last_revived_count AS lastRevivedCount,
            last_unknown_count AS lastUnknownCount,
            last_error AS lastError
       FROM video_liveness_state WHERE id = 1`
  );
}

export function buildLivenessStatus(state, count) {
  return {
    count: number(count),
    schedule: LIVENESS_CRON,
    batchSize: LIVENESS_BATCH_SIZE,
    probe: 'range-get-first-byte',
    concurrency: PROBE_CONCURRENCY,
    phase: state?.phase || BASE_PHASE,
    cycle: number(state?.cycle),
    cursor: state?.phase === DEATH_PHASE
      ? String(state?.deathCursorKey || '')
      : number(state?.baseCursorId),
    upperBound: state?.phase === DEATH_PHASE
      ? String(state?.deathUpperKey || '')
      : number(state?.baseUpperId),
    checkedTotal: number(state?.checkedTotal),
    deadTotal: number(state?.deadTotal),
    revivedTotal: number(state?.revivedTotal),
    lastRunAt: state?.lastRunAt || null,
    lastCheckedCount: number(state?.lastCheckedCount),
    lastDeadCount: number(state?.lastDeadCount),
    lastRevivedCount: number(state?.lastRevivedCount),
    lastUnknownCount: number(state?.lastUnknownCount),
    lastError: state?.lastError || null
  };
}

async function acquireRunState(db) {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const lockUntil = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const row = await db.prepare(
    `UPDATE video_liveness_state
        SET lock_token = ?,
            lock_until = ?,
            base_cursor_id = CASE
              WHEN phase = 'base' AND base_upper_id = 0 THEN 0
              ELSE base_cursor_id
            END,
            base_upper_id = CASE
              WHEN phase = 'base' AND base_upper_id = 0 THEN ${BASE_UPPER_ID_SQL}
              ELSE base_upper_id
            END,
            death_cursor_key = CASE
              WHEN phase = 'death' AND death_upper_key = '' THEN ''
              ELSE death_cursor_key
            END,
            death_upper_key = CASE
              WHEN phase = 'death' AND death_upper_key = '' THEN ${DEATH_UPPER_KEY_SQL}
              ELSE death_upper_key
            END
      WHERE id = 1 AND (lock_until IS NULL OR lock_until < ?)
      RETURNING phase,
                base_cursor_id AS baseCursorId,
                base_upper_id AS baseUpperId,
                death_cursor_key AS deathCursorKey,
                death_upper_key AS deathUpperKey,
                cycle`
  ).bind(token, lockUntil, now).first();
  if (!row) return null;
  return {
    token,
    state: {
      phase: row.phase === DEATH_PHASE ? DEATH_PHASE : BASE_PHASE,
      baseCursorId: number(row.baseCursorId),
      baseUpperId: number(row.baseUpperId),
      deathCursorKey: String(row.deathCursorKey || ''),
      deathUpperKey: String(row.deathUpperKey || ''),
      cycle: number(row.cycle)
    }
  };
}

async function releaseLock(db, token) {
  await db.prepare(
    `UPDATE video_liveness_state
        SET lock_token = NULL, lock_until = NULL
      WHERE id = 1 AND lock_token = ?`
  ).bind(token).run();
}

async function transitionPhase(db, state) {
  if (state.phase === BASE_PHASE) {
    const row = await db.prepare(
      `UPDATE video_liveness_state
          SET phase = 'death',
              base_cursor_id = 0,
              base_upper_id = 0,
              death_cursor_key = '',
              death_upper_key = ${DEATH_UPPER_KEY_SQL}
        WHERE id = 1
        RETURNING death_upper_key AS deathUpperKey`
    ).first();
    return {
      ...state,
      phase: DEATH_PHASE,
      baseCursorId: 0,
      baseUpperId: 0,
      deathCursorKey: '',
      deathUpperKey: String(row?.deathUpperKey || '')
    };
  }

  const row = await db.prepare(
    `UPDATE video_liveness_state
        SET phase = 'base',
            death_cursor_key = '',
            death_upper_key = '',
            base_cursor_id = 0,
            base_upper_id = ${BASE_UPPER_ID_SQL},
            cycle = COALESCE(cycle, 0) + 1
      WHERE id = 1
      RETURNING base_upper_id AS baseUpperId, cycle`
  ).first();
  return {
    ...state,
    phase: BASE_PHASE,
    baseCursorId: 0,
    baseUpperId: number(row?.baseUpperId),
    deathCursorKey: '',
    deathUpperKey: '',
    cycle: number(row?.cycle)
  };
}

async function selectRows(db, state, limit) {
  if (state.phase === BASE_PHASE) {
    const result = await db.prepare(
      `SELECT video.id, video.media_url AS mediaUrl,
              video.canonical_key AS canonicalKey,
              video.last_http_status AS lastHttpStatus,
              video.fail_count AS failCount
         FROM videos AS video
        WHERE video.id > ? AND video.id <= ?
          AND video.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM video_blocklist AS bad
            WHERE bad.canonical_key = video.canonical_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM video_death_list AS death
            WHERE death.canonical_key = video.canonical_key
          )
        ORDER BY video.id
        LIMIT ?`
    ).bind(state.baseCursorId, state.baseUpperId, limit).all();
    return result.results || [];
  }

  const result = await db.prepare(
    `SELECT video_id AS id,
              media_url AS mediaUrl,
              canonical_key AS canonicalKey
       FROM video_death_list
      WHERE canonical_key > ? AND canonical_key <= ?
      ORDER BY canonical_key
      LIMIT ?`
  ).bind(state.deathCursorKey, state.deathUpperKey, limit).all();
  return result.results || [];
}

function baseMutationStatements(db, payload, checkedAt, hasDead) {
  const statements = [];
  if (hasDead) {
    statements.push(
      baseLivenessStatusDeltaStatement(db, payload, checkedAt),
      db.prepare(
        `WITH input AS (
           SELECT CAST(json_extract(value, '$.id') AS INTEGER) AS id,
                  json_extract(value, '$.mediaUrl') AS mediaUrl,
                  json_extract(value, '$.canonicalKey') AS canonicalKey,
                  CAST(json_extract(value, '$.httpStatus') AS INTEGER) AS httpStatus
             FROM json_each(?)
            WHERE json_extract(value, '$.state') = 'dead'
         )
         INSERT INTO video_death_list (
           canonical_key, media_url, video_id, detected_at,
           last_checked_at, last_http_status, check_count
         )
         SELECT canonicalKey, mediaUrl, id, ?, ?, httpStatus, 1
           FROM input
          WHERE 1
         ON CONFLICT(canonical_key) DO UPDATE SET
           media_url = excluded.media_url,
           video_id = excluded.video_id,
           last_checked_at = excluded.last_checked_at,
           last_http_status = excluded.last_http_status,
           check_count = COALESCE(video_death_list.check_count, 0) + 1`
      ).bind(payload, checkedAt, checkedAt)
    );
  }

  statements.push(db.prepare(
    `WITH input AS (
       SELECT CAST(json_extract(value, '$.id') AS INTEGER) AS id,
              json_extract(value, '$.state') AS state,
              CAST(json_extract(value, '$.httpStatus') AS INTEGER) AS httpStatus
         FROM json_each(?)
     )
     UPDATE videos
        SET status = CASE WHEN input.state = 'dead' THEN 'dead' ELSE videos.status END,
            last_checked_at = ?,
            last_http_status = COALESCE(input.httpStatus, videos.last_http_status),
            fail_count = CASE
              WHEN input.state = 'alive' THEN 0
              ELSE COALESCE(videos.fail_count, 0) + 1
            END
       FROM input
      WHERE videos.id = input.id`
  ).bind(payload, checkedAt));

  if (hasDead) {
    statements.push(db.prepare(
      `DELETE FROM ranking_entries
        WHERE video_id IN (
          SELECT CAST(json_extract(value, '$.id') AS INTEGER)
            FROM json_each(?)
           WHERE json_extract(value, '$.state') = 'dead'
        )`
    ).bind(payload));
  }
  return statements;
}

function deathMutationStatements(db, payload, checkedAt, hasRevived, hasUnresolved) {
  const statements = [];
  if (hasRevived) {
    statements.push(
      db.prepare(
        `DELETE FROM video_death_list
          WHERE canonical_key IN (
            SELECT json_extract(value, '$.canonicalKey')
              FROM json_each(?)
             WHERE json_extract(value, '$.state') = 'alive'
          )`
      ).bind(payload),
      db.prepare(
        `WITH input AS (
           SELECT json_extract(value, '$.canonicalKey') AS canonicalKey,
                  CAST(json_extract(value, '$.httpStatus') AS INTEGER) AS httpStatus
             FROM json_each(?)
            WHERE json_extract(value, '$.state') = 'alive'
         )
         UPDATE videos
            SET status = CASE WHEN EXISTS (
                  SELECT 1 FROM video_blocklist AS bad
                   WHERE bad.canonical_key = videos.canonical_key
                ) THEN 'hidden' ELSE 'active' END,
                last_checked_at = ?,
                last_http_status = input.httpStatus,
                fail_count = 0
           FROM input
          WHERE videos.canonical_key = input.canonicalKey`
      ).bind(payload, checkedAt),
      restoreRevivedRankingStatement(db, payload, checkedAt)
    );
  }

  if (hasUnresolved) {
    statements.push(db.prepare(
      `WITH input AS (
         SELECT json_extract(value, '$.canonicalKey') AS canonicalKey,
                CAST(json_extract(value, '$.httpStatus') AS INTEGER) AS httpStatus
           FROM json_each(?)
          WHERE json_extract(value, '$.state') <> 'alive'
       )
       UPDATE video_death_list
          SET last_checked_at = ?,
              last_http_status = COALESCE(input.httpStatus, video_death_list.last_http_status),
              check_count = COALESCE(video_death_list.check_count, 0) + 1
         FROM input
        WHERE video_death_list.canonical_key = input.canonicalKey`
    ).bind(payload, checkedAt));
  }
  if (hasRevived) statements.push(deathLivenessStatusDeltaStatement(db, payload, checkedAt));
  return statements;
}

export async function applyProbeResults(db, phase, rows, probes, checkedAt) {
  const mutations = [];
  let deadCount = 0;
  let revivedCount = 0;
  let unknownCount = 0;
  let hasDead = false;
  let hasRevived = false;
  let hasUnresolved = false;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const probe = probes[index];
    const state = probe.state;
    const httpStatus = probe.status ?? null;

    if (phase === BASE_PHASE) {
      if (state === 'dead') {
        deadCount += 1;
        hasDead = true;
      } else if (state === 'unknown') {
        unknownCount += 1;
      } else if (!shouldRefreshAliveMetadata(row, httpStatus)) {
        continue;
      }
    } else if (state === 'alive') {
      revivedCount += 1;
      hasRevived = true;
    } else {
      hasUnresolved = true;
      if (state === 'unknown') unknownCount += 1;
    }

    mutations.push({
      id: row.id,
      mediaUrl: row.mediaUrl,
      canonicalKey: row.canonicalKey,
      state,
      httpStatus
    });
  }

  if (mutations.length) {
    const payload = JSON.stringify(mutations);
    const statements = phase === BASE_PHASE
      ? baseMutationStatements(db, payload, checkedAt, hasDead)
      : deathMutationStatements(db, payload, checkedAt, hasRevived, hasUnresolved);
    if (statements.length) await db.batch(statements);
  }

  return {
    deadCount,
    revivedCount,
    unknownCount,
    feedChanged: deadCount > 0 || revivedCount > 0
  };
}

export async function recordRunAndRelease(db, token, values, state) {
  const result = await db.prepare(
    `UPDATE video_liveness_state
        SET phase = COALESCE(?, phase),
            base_cursor_id = COALESCE(?, base_cursor_id),
            base_upper_id = COALESCE(?, base_upper_id),
            death_cursor_key = COALESCE(?, death_cursor_key),
            death_upper_key = COALESCE(?, death_upper_key),
            cycle = COALESCE(?, cycle),
            checked_total = COALESCE(checked_total, 0) + ?,
            dead_total = COALESCE(dead_total, 0) + ?,
            revived_total = COALESCE(revived_total, 0) + ?,
            last_run_at = ?,
            last_checked_count = ?,
            last_dead_count = ?,
            last_revived_count = ?,
            last_unknown_count = ?,
            last_error = ?,
            lock_token = NULL,
            lock_until = NULL
      WHERE id = 1 AND lock_token = ?`
  ).bind(
    state?.phase ?? null,
    state?.baseCursorId ?? null,
    state?.baseUpperId ?? null,
    state?.deathCursorKey ?? null,
    state?.deathUpperKey ?? null,
    state?.cycle ?? null,
    values.checkedCount,
    values.deadCount,
    values.revivedCount,
    values.completedAt,
    values.checkedCount,
    values.deadCount,
    values.revivedCount,
    values.unknownCount,
    values.error || null,
    token
  ).run();
  return number(result.meta?.changes) > 0;
}

export async function runLivenessMonitor(env) {
  const acquired = await acquireRunState(env.DB);
  if (!acquired) return { ok: true, skipped: true, reason: 'already-running' };

  const { token } = acquired;
  const totals = { checkedCount: 0, deadCount: 0, revivedCount: 0, unknownCount: 0 };
  let error = null;
  let state = acquired.state;

  try {
    let remaining = LIVENESS_BATCH_SIZE;
    let transitions = 0;

    while (remaining > 0 && transitions < 2) {
      const phaseHasSnapshot = state.phase === BASE_PHASE
        ? state.baseUpperId > 0
        : Boolean(state.deathUpperKey);

      if (!phaseHasSnapshot) {
        const previousPhase = state.phase;
        state = await transitionPhase(env.DB, state);
        transitions += 1;
        if (previousPhase === DEATH_PHASE) break;
        continue;
      }

      const rows = await selectRows(env.DB, state, remaining);
      if (!rows.length) {
        const previousPhase = state.phase;
        state = await transitionPhase(env.DB, state);
        transitions += 1;
        if (previousPhase === DEATH_PHASE) break;
        continue;
      }

      const row = rows[0];
      if (state.phase === BASE_PHASE) state = { ...state, baseCursorId: number(row.id) };
      else state = { ...state, deathCursorKey: row.canonicalKey };

      const probe = await probeVideoUrl(row.mediaUrl);
      const checkedAt = new Date().toISOString();
      const result = await applyProbeResults(env.DB, state.phase, [row], [probe], checkedAt);
      totals.checkedCount += 1;
      totals.deadCount += result.deadCount;
      totals.revivedCount += result.revivedCount;
      totals.unknownCount += result.unknownCount;
      remaining -= 1;
    }

  } catch (caught) {
    error = shortError(caught);
    console.error('video-liveness-monitor-failed', { error });
  } finally {
    const recorded = await recordRunAndRelease(env.DB, token, {
      ...totals,
      completedAt: new Date().toISOString(),
      error
    }, state).catch(async (recordError) => {
      if (!error) error = `failed-to-record-liveness-run: ${shortError(recordError)}`;
      await releaseLock(env.DB, token).catch((releaseError) => {
        if (!error) error = `failed-to-release-liveness-lock: ${shortError(releaseError)}`;
      });
      return false;
    });

    if (!recorded && !error) {
      error = 'failed-to-record-liveness-run';
      await releaseLock(env.DB, token).catch((releaseError) => {
        error = `failed-to-release-liveness-lock: ${shortError(releaseError)}`;
      });
    }
  }

  if (error) throw new Error(error);
  return { ok: true, skipped: false, ...totals };
}
