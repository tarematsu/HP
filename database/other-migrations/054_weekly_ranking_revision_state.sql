CREATE TABLE IF NOT EXISTS sh_weekly_ranking_revision_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  source_revision INTEGER NOT NULL DEFAULT 0,
  refreshed_at INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO sh_weekly_ranking_revision_state(id,source_revision,refreshed_at)
VALUES(1,0,0);
