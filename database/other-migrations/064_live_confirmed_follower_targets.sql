-- Dynamic follower targets are eligible only after the collector observes the
-- account handle while that account is actively broadcasting.
ALTER TABLE sh_stationhead_follower_targets
  ADD COLUMN live_confirmed_at INTEGER;

-- Existing dynamic rows cannot prove that their handle was captured from a live
-- broadcast snapshot. Keep fixed/manual targets, and require dynamic accounts to
-- be observed live again before follower collection resumes for them.
DELETE FROM sh_stationhead_follower_targets
WHERE (source_mask & 1)=0;

-- Prevent historical session discovery (or any other non-live path) from adding
-- dynamic follower targets without a live confirmation timestamp.
CREATE TRIGGER IF NOT EXISTS sh_stationhead_follower_targets_require_live_confirmation
BEFORE INSERT ON sh_stationhead_follower_targets
WHEN (NEW.source_mask & 1)=0 AND NEW.live_confirmed_at IS NULL
BEGIN
  SELECT RAISE(IGNORE);
END;
