-- Stationhead comment collection is retired across Buddies and official-account
-- monitors. Remove comment-only storage and erase historical derived values from
-- compatibility columns that remain in shared host/read-model tables.

DROP TABLE IF EXISTS sh_official_news_comments;
DROP TABLE IF EXISTS sh_solo_activity_state;
DROP TABLE IF EXISTS sh_solo_activity_minutes;
DROP TABLE IF EXISTS sh_solo_activity_days;
DROP TABLE IF EXISTS sh_sakurazaka46jp_chat;
DROP TABLE IF EXISTS sh_nogizaka46smej_chat;

UPDATE sh_host_broadcast_sessions
SET comment_count=0
WHERE comment_count<>0;

UPDATE sh_host_station_snapshots
SET comment_velocity=NULL
WHERE comment_velocity IS NOT NULL;

UPDATE sh_official_broadcast_summary
SET comment_count=NULL
WHERE comment_count IS NOT NULL;
