// Stationhead comment collection was retired. Keep this compatibility shim
// temporarily for old queue payloads/tests; it performs no D1 reads and returns
// no comment-derived facts.
export async function loadMinuteCommentFacts() {
  return { commentCount: null, commentTotal: null };
}
