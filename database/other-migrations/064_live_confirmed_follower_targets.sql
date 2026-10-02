-- Dynamic follower targets are eligible only after the collector observes the
-- account handle while that account is actively broadcasting. Historical
-- broadcast/session discovery may keep registry rows for diagnostics, but those
-- rows must remain ineligible until a live observation confirms them.
ALTER TABLE sh_stationhead_follower_targets
  ADD COLUMN live_confirmed_at INTEGER;
