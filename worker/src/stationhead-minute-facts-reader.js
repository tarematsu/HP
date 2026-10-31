// Source-scoped D1 fact reads: column lists and time keys are explicit because
// Buddies and Ohisama have different schemas and cursor semantics.
const GAP_QUERIES = Object.freeze({
  buddies: `SELECT
      facts.channel_id,context.station_id,facts.minute_at,facts.observed_at,facts.is_broadcasting,
      facts.listener_count,facts.online_member_count,facts.total_member_count,facts.guest_count,
      facts.reported_total_listens,facts.reported_current_stream_count,context.broadcast_start_time
    FROM sh_minute_facts facts
    LEFT JOIN sh_minute_fact_context context ON context.fact_id=facts.id
    WHERE facts.channel_id=? AND facts.minute_at>? AND facts.minute_at<?
    ORDER BY facts.minute_at ASC,facts.id ASC`,
  ohisama: `SELECT
      channel_id,station_id,is_broadcasting,observed_at,
      online_member_count,total_member_count,reported_current_stream_count
    FROM sh_minute_facts
    WHERE channel_id=? AND observed_at>? AND observed_at<?
    ORDER BY observed_at ASC,id ASC`,
});

export async function loadStationheadMinuteFactGapRows(db, source, channelId, after, before) {
  const query = GAP_QUERIES[source];
  if (!query) throw new Error(`unsupported Stationhead fact source: ${String(source)}`);
  if (typeof db?.prepare !== 'function') throw new Error(`D1 binding missing for ${source} fact recovery`);
  const result = await db.prepare(query).bind(channelId, after, before).all();
  return Array.isArray(result?.results) ? result.results : [];
}
