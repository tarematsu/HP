-- Nogizaka queue history is already stored by the shared host queue event model.
-- This per-minute copy duplicated the same queue rows and presentation metadata.
DROP TABLE IF EXISTS sh_nogizaka46smej_track_metadata;
