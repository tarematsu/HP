import { timeoutForMethod } from './collection-guardrails.js';

const STALE_RUN_GRACE_MS = 30_000;

export async function closeStaleCollectionRuns(env, configs, nowMs = Date.now()) {
  if (!configs.length) return 0;
  const completedAt = new Date(nowMs).toISOString();
  const predicates = [];
  const bindings = [completedAt];

  for (const config of configs) {
    predicates.push('(source_method = ? AND started_at < ?)');
    bindings.push(
      config.method,
      new Date(nowMs - timeoutForMethod(config.method) - STALE_RUN_GRACE_MS).toISOString()
    );
  }

  const result = await env.DB.prepare(
    `UPDATE collection_runs
        SET completed_at = ?,
            error = COALESCE(
              NULLIF(error, ''),
              source_method || ' previous run ended without completion metadata'
            )
      WHERE completed_at IS NULL
        AND (${predicates.join(' OR ')})`
  ).bind(...bindings).run();
  return Number(result?.meta?.changes || 0);
}
