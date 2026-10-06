// Stationhead comment-count collection has been retired. Keep this no-op
// compatibility entrypoint temporarily so stale ingest messages cannot recreate
// comment aggregates while older producers drain.
export async function saveSoloActivityCounts() {
  return {
    accepted: 0,
    total: 0,
    velocity: 0,
    velocityUpdated: false,
    retired: true,
  };
}
