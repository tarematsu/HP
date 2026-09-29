-- Temporary production-path validation for the isolated Nogizaka collector.
-- The follow-up cleanup migration removes this test announcement, trigger, and test rows.

CREATE TRIGGER IF NOT EXISTS trg_nogizaka_sakuramankai_test_ignore_buddies
AFTER INSERT ON sh_nogizaka46smej_main
BEGIN
  UPDATE sh_nogizaka46smej_main
  SET buddies_station_id = NULL
  WHERE id = NEW.id;
END;

INSERT INTO sh_nogizaka_official_news_announcements (
  news_id, news_url, published_date, title, event_name,
  scheduled_at, detected_at, updated_at, status, raw_text
) VALUES (
  'manual-test-sakuramankai-20260930',
  'https://www.nogizaka46.com/',
  '2026-09-30',
  '[collector test] sakuramankai',
  'Nogizaka collector temporary sakuramankai test',
  1790703900000,
  1790703900000,
  1790703900000,
  'scheduled',
  'Temporary collector validation. Not an official Nogizaka announcement.'
)
ON CONFLICT(news_id, scheduled_at) DO UPDATE SET
  status = 'scheduled',
  inactive_streak = 0,
  updated_at = excluded.updated_at;
