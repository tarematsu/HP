-- Bound the temporary July repair candidate scan to rows that can actually
-- match the source-corruption predicate. Without this partial index, every
-- one-minute burst can revisit the full four-day fact window before applying
-- the repair ledger anti-join.
CREATE INDEX IF NOT EXISTS idx_sh_minute_facts_repair_candidates
  ON sh_minute_facts(minute_at,channel_id,id)
  WHERE reported_total_listens IS NOT NULL
    AND (
      (reported_current_stream_count IS NOT NULL
        AND reported_current_stream_count=reported_total_listens)
      OR (reported_current_stream_count IS NULL AND (quality_flags & 64) != 0)
    );
