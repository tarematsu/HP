export async function recordFinalizationFailure(env, results, error) {
  const source = [...results].reverse().find(
    (entry) => entry?.ok && Number(entry?.result?.runId) > 0
  );
  if (!source) return false;

  const message = `playback feed finalization failed: ${String(error?.message || error)}`.slice(0, 1000);
  const update = await env.DB.prepare(
    `UPDATE collection_runs
        SET error = ?
      WHERE id = ? AND NULLIF(error, '') IS NULL`
  ).bind(message, source.result.runId).run();
  return Number(update?.meta?.changes || 0) > 0;
}
