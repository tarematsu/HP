export const RECENT_REGISTRATION_LIMIT = 10;

export function prepareRecentRegistrationsRead(db, limit = RECENT_REGISTRATION_LIMIT) {
  const parsed = Math.trunc(Number(limit) || RECENT_REGISTRATION_LIMIT);
  const boundedLimit = Math.min(50, Math.max(1, parsed));
  return db.prepare(
    `SELECT id AS id,
            media_url AS mediaUrl,
            media_type AS mediaType,
            status AS status,
            first_seen_at AS firstSeenAt
       FROM videos
      ORDER BY id DESC
      LIMIT ?`
  ).bind(boundedLimit);
}
