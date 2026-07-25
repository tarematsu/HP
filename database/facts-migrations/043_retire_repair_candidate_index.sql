-- Retire the deploy-blocking one-off repair index.
-- The repair scanner now advances once through the existing minute_at index
-- and persists its keyset cursor in sh_migration_state.
DROP INDEX IF EXISTS idx_sh_minute_facts_repair_candidates;
