-- These Ohisama-derived accounts are intentionally excluded from follower tracking.
DELETE FROM sh_stationhead_follower_targets
WHERE LOWER(TRIM(handle)) IN ('46fm', 'buddy46');
