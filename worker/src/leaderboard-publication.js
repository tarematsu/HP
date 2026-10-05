// The Queue consumer and Actions repair path publish the same API envelope.
export function leaderboardPublication(model, updatedAt, source = {}) {
  return {
    version: 1,
    updated_at: updatedAt,
    ...source,
    cadence_seconds: 7 * 86400,
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
    },
    body: JSON.stringify(model),
  };
}
