-- The monthly history API remains available, but it is no longer published as
-- a materialized Pages read model. Remove the revision row and triggers that
-- existed only to dispatch history:monthly regeneration.

DROP TRIGGER IF EXISTS trg_rmrev_monthly_insert;
DROP TRIGGER IF EXISTS trg_rmrev_monthly_update;
DROP TRIGGER IF EXISTS trg_rmrev_monthly_delete;

DELETE FROM sh_read_model_revision WHERE model_key='history:monthly';
