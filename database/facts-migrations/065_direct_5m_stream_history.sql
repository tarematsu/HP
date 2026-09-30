-- minute_facts are now emitted once per five-minute sample.  The old model
-- averaged one-minute deltas and therefore no longer represents the source
-- cadence.  Current-tab stream growth is derived directly from adjacent
-- sh_dashboard_history_5m samples instead, so these triggers/table only add
-- write/read amplification.
DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_after_insert;
DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_after_update;
DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_late_insert;
DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_boundary_insert;
DROP TABLE IF EXISTS sh_stream_5m_average_read_model;

PRAGMA optimize;
