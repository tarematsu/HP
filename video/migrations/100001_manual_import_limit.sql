CREATE TRIGGER IF NOT EXISTS manual_import_jobs_max_urls_insert
BEFORE INSERT ON manual_import_jobs
WHEN NEW.total_urls > 300
BEGIN
  SELECT RAISE(ABORT, 'manual import job exceeds 300 URLs');
END;

CREATE TRIGGER IF NOT EXISTS manual_import_jobs_max_urls_update
BEFORE UPDATE OF total_urls ON manual_import_jobs
WHEN NEW.total_urls > 300
BEGIN
  SELECT RAISE(ABORT, 'manual import job exceeds 300 URLs');
END;
