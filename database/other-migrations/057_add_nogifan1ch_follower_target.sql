-- Add nogifan1ch as a permanent Stationhead follower collection target.
INSERT INTO sh_stationhead_follower_targets(handle,source_mask,first_seen_at)
VALUES('nogifan1ch',1,0)
ON CONFLICT(handle) DO UPDATE SET
  source_mask=(sh_stationhead_follower_targets.source_mask | excluded.source_mask);
