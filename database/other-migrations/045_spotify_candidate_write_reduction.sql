-- sh_spotify_playcount_candidates is keyed by (snapshot_date, track_id).
-- All production reads constrain snapshot_date, so the extra run-token index
-- duplicates the hot candidate write path without materially improving the
-- once-per-attempt finalization scan.
DROP INDEX IF EXISTS idx_sh_spotify_candidates_run;

-- Duplicate Queue deliveries for the same run used to execute an UPDATE only
-- to advance collected_at (and sometimes restate album_id) even when the
-- cumulative playcount had not advanced. Candidate finalization only depends
-- on the highest playcount for the active run, so keep the first observation
-- until a strictly higher cumulative count arrives.
CREATE TRIGGER IF NOT EXISTS trg_sh_spotify_candidates_skip_nonadvance
BEFORE UPDATE ON sh_spotify_playcount_candidates
FOR EACH ROW
WHEN OLD.run_token = NEW.run_token
  AND NEW.playcount <= OLD.playcount
BEGIN
  SELECT RAISE(IGNORE);
END;
