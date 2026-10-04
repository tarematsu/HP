import {
  jstDateKey,
  jstHour,
} from './spotify-playcount-common.js';
import { runSpotifyPlaycountScheduled } from './spotify-playcount-schedule.js';
import { spotifyArtistDailyRefreshStatements } from './spotify-playcount-summary.js';
import { requestSpotifyReadModelRefresh } from './spotify-pages-read-model.js';
import { probeStaleSpotifyUpdate } from './spotify-stale-update-probe.js';
import {
  isSpotifyFastRetryWindow,
  isSpotifyHourlyBoundary,
} from './spotify-playcount-timing.js';

async function carryForwardExpiredStaleDays(db, scheduledTime) {
  if (!db?.prepare || jstHour(scheduledTime) !== 5) return 0;

  const today = jstDateKey(scheduledTime);
  const result = await db.prepare(`SELECT snapshot_date
    FROM sh_spotify_collection_runs
    WHERE snapshot_date < ? AND status='stale'
    ORDER BY snapshot_date`).bind(today).all();
  const staleDates = Array.isArray(result?.results) ? result.results : [];
  let carried = 0;

  for (const row of staleDates) {
    const snapshotDate = String(row.snapshot_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) continue;

    const baseline = await db.prepare(`SELECT MAX(snapshot_date) AS snapshot_date
      FROM sh_spotify_playcount_daily
      WHERE snapshot_date < ?`).bind(snapshotDate).first();
    const baselineDate = String(baseline?.snapshot_date || '');
    if (!baselineDate) continue;

    const now = Date.now();
    await db.prepare(`INSERT INTO sh_spotify_playcount_daily (
        snapshot_date,track_id,playcount,delta,collected_at,is_carried_forward
      )
      SELECT ?,track_id,playcount,NULL,?,1
      FROM sh_spotify_playcount_daily
      WHERE snapshot_date=?
      ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
        playcount=excluded.playcount,
        delta=NULL,
        collected_at=excluded.collected_at,
        is_carried_forward=1`)
      .bind(snapshotDate, now, baselineDate)
      .run();

    for (const statement of spotifyArtistDailyRefreshStatements(db, snapshotDate, now)) {
      await statement.run();
    }

    await db.prepare(`UPDATE sh_spotify_collection_runs
      SET status='complete',
          tracks_collected=(
            SELECT COUNT(*) FROM sh_spotify_playcount_daily WHERE snapshot_date=?
          ),
          completed_at=?,updated_at=?,
          last_error=NULL
      WHERE snapshot_date=? AND status='stale'`)
      .bind(snapshotDate, now, now, snapshotDate)
      .run();

    await db.batch([
      db.prepare(`DELETE FROM sh_spotify_playcount_candidates WHERE snapshot_date=?`).bind(snapshotDate),
      db.prepare(`DELETE FROM sh_spotify_collection_album_runs WHERE snapshot_date=?`).bind(snapshotDate),
    ]);
    carried += 1;
  }

  return carried;
}

async function runScheduledCollection(controller, env, scheduledTime, dependencies = {}) {
  const hourlyBoundary = isSpotifyHourlyBoundary(scheduledTime);
  const fastRetryWindow = isSpotifyFastRetryWindow(scheduledTime);
  const probe = dependencies.probeStaleSpotifyUpdate || probeStaleSpotifyUpdate;
  const runCollection = dependencies.runSpotifyPlaycountScheduled || runSpotifyPlaycountScheduled;

  if (hourlyBoundary || fastRetryWindow) {
    const probeResult = await probe(env, scheduledTime, dependencies);
    if (probeResult.stale) {
      console.log(JSON.stringify({
        event: 'spotify_stale_source_probe',
        scheduled_at: scheduledTime,
        ...probeResult,
      }));
      if (probeResult.changed) return runCollection(controller, env);

      if (probeResult.reason === 'no-probe-tracks' && hourlyBoundary) {
        return runCollection(controller, env);
      }
      return {
        skipped: true,
        reason: probeResult.reason,
        snapshot_date: probeResult.snapshot_date || null,
        checked_tracks: probeResult.checked_tracks || 0,
      };
    }

    if (fastRetryWindow && !hourlyBoundary) {
      return { skipped: true, reason: 'fast-retry-no-stale-day' };
    }
  }

  return runCollection(controller, env);
}

export async function runSpotifyScheduledWork(controller, env, dependencies = {}) {
  const rawScheduledTime = Number(controller?.scheduledTime);
  const scheduledTime = Number.isFinite(rawScheduledTime) ? rawScheduledTime : Date.now();
  const carryForward = dependencies.carryForwardExpiredStaleDays || carryForwardExpiredStaleDays;
  const requestRefresh = dependencies.requestSpotifyReadModelRefresh || requestSpotifyReadModelRefresh;
  const carried = await carryForward(env?.OTHER_DB, scheduledTime);
  if (carried > 0) {
    await requestRefresh(env, 'playcount-carry-forward', { carried_days: carried });
  }
  return runScheduledCollection(controller, env, scheduledTime, dependencies);
}
