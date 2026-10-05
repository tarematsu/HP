-- Track history is R2-native, so expose its publication revision through the
-- same compact D1 revision table used by Pages history read models.
INSERT OR IGNORE INTO sh_read_model_revision(model_key,revision,updated_at)
VALUES('track-history',1,unixepoch()*1000);
