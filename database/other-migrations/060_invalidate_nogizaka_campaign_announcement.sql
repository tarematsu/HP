-- News 102277 is the September 2026 letter campaign, not a Stationhead event.
-- The old parser included adjacent/latest news. Preserve rows as evidence and
-- never touch a collected broadcast or the real Stationhead article (102280).
UPDATE sh_nogizaka_official_news_announcements
SET status='invalid'
WHERE news_id='102277'
  AND status IN ('scheduled','time_unknown','missed')
  AND first_broadcast_at IS NULL AND last_broadcast_at IS NULL;
