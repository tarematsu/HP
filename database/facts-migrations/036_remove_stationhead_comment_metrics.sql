-- Retire comment-derived Stationhead facts and the deferred comment task queue.
DROP TABLE IF EXISTS sh_minute_comment_tasks;

-- Keep the legacy columns temporarily for schema compatibility, but delete the
-- stored feature data. Current writers/readers no longer populate these fields.
UPDATE sh_minute_facts
SET comment_count = NULL,
    comment_total = NULL,
    comments_degraded = 0
WHERE comment_count IS NOT NULL
   OR comment_total IS NOT NULL
   OR comments_degraded <> 0;

UPDATE sh_dashboard_history_5m
SET comment_velocity = 0
WHERE comment_velocity <> 0;
