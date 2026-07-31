-- Resolve official-host sessions before touching the large minute-facts table,
-- then seek only that session's event window. Sparse host overrides retain a
-- bounded fallback through the canonical context index.
--
-- Every statement is intentionally idempotent. Deployment may re-run this
-- migration after a transient remote D1 import/bookmark conflict.
CREATE INDEX IF NOT EXISTS idx_sh_broadcast_sessions_host_id
ON sh_broadcast_sessions(host_id,id)
WHERE host_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sh_minute_facts_session_minute
ON sh_minute_facts(broadcast_session_id,minute_at,id)
WHERE broadcast_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sh_minute_fact_context_host_fact
ON sh_minute_fact_context_v2(host_id_override,fact_id)
WHERE host_id_override IS NOT NULL;

ANALYZE sh_broadcast_sessions;
ANALYZE sh_minute_facts;
ANALYZE sh_minute_fact_context_v2;
