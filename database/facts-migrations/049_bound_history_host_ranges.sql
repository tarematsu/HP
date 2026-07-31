-- Bound official-host series before touching the large minute-facts table.
-- Session-backed rows resolve by host/window; sparse host overrides resolve by
-- host/fact id and then use the minute-fact natural-key range.
CREATE INDEX IF NOT EXISTS idx_sh_broadcast_sessions_host_window
ON sh_broadcast_sessions(host_id,first_observed_at,last_observed_at,channel_id)
WHERE host_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sh_minute_fact_context_host_fact
ON sh_minute_fact_context_v2(host_id_override,fact_id)
WHERE host_id_override IS NOT NULL;

ANALYZE sh_broadcast_sessions;
ANALYZE sh_minute_fact_context_v2;
