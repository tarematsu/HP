PRAGMA foreign_keys = ON;

-- SwitchBot has an independent device-sync payload/version. Keep fast Plug Mini
-- updates from invalidating and retransmitting dashboard.json, whose native
-- consumer now owns only weather/Octopus panel data.
DROP TRIGGER IF EXISTS sync_manifest_on_state_insert;
DROP TRIGGER IF EXISTS sync_manifest_on_state_update;
DROP TRIGGER IF EXISTS sync_manifest_on_state_delete;

-- Repair the aggregate produced by the previous triggers before installing the
-- split ownership rules. switchbot_version is exactly the contribution that was
-- previously included in dashboard_version.
UPDATE sync_manifest
   SET dashboard_version = MAX(0, dashboard_version - switchbot_version)
 WHERE id = 1;

CREATE TRIGGER sync_manifest_on_state_insert
AFTER INSERT ON current_state
WHEN NEW.source IN (
  'weather','news','octopus','switchbot','stationhead','environment',
  'radar','stationhead_health'
)
BEGIN
  UPDATE sync_manifest
     SET dashboard_version=dashboard_version + CASE WHEN NEW.source IN (
           'weather','news','octopus','stationhead','environment'
         ) THEN NEW.version ELSE 0 END,
         environment_version = CASE WHEN NEW.source='environment' THEN NEW.version ELSE environment_version END,
         environment_fetched_at = CASE WHEN NEW.source='environment' THEN NEW.fetched_at ELSE environment_fetched_at END,
         radar_version = CASE WHEN NEW.source='radar' THEN NEW.version ELSE radar_version END,
         switchbot_version = CASE WHEN NEW.source='switchbot' THEN NEW.version ELSE switchbot_version END,
         stationhead_version = CASE WHEN NEW.source='stationhead' THEN NEW.version ELSE stationhead_version END,
         stationhead_health_version = CASE WHEN NEW.source='stationhead_health' THEN NEW.version ELSE stationhead_health_version END,
         updated_at=MAX(updated_at,NEW.fetched_at)
   WHERE id=1;
END;

CREATE TRIGGER sync_manifest_on_state_update
AFTER UPDATE OF version,fetched_at ON current_state
WHEN NEW.source IN (
       'weather','news','octopus','switchbot','stationhead','environment',
       'radar','stationhead_health'
     )
 AND (
       NEW.version<>OLD.version
       OR (NEW.source='environment' AND NEW.fetched_at<>OLD.fetched_at)
     )
BEGIN
  UPDATE sync_manifest
     SET dashboard_version=dashboard_version + CASE WHEN NEW.source IN (
           'weather','news','octopus','stationhead','environment'
         ) THEN NEW.version-OLD.version ELSE 0 END,
         environment_version = CASE WHEN NEW.source='environment' THEN NEW.version ELSE environment_version END,
         environment_fetched_at = CASE WHEN NEW.source='environment' THEN NEW.fetched_at ELSE environment_fetched_at END,
         radar_version = CASE WHEN NEW.source='radar' THEN NEW.version ELSE radar_version END,
         switchbot_version = CASE WHEN NEW.source='switchbot' THEN NEW.version ELSE switchbot_version END,
         stationhead_version = CASE WHEN NEW.source='stationhead' THEN NEW.version ELSE stationhead_version END,
         stationhead_health_version = CASE WHEN NEW.source='stationhead_health' THEN NEW.version ELSE stationhead_health_version END,
         updated_at=MAX(updated_at,NEW.fetched_at)
   WHERE id=1;
END;

CREATE TRIGGER sync_manifest_on_state_delete
AFTER DELETE ON current_state
WHEN OLD.source IN (
  'weather','news','octopus','switchbot','stationhead','environment',
  'radar','stationhead_health'
)
BEGIN
  UPDATE sync_manifest
     SET dashboard_version=MAX(0,dashboard_version - CASE WHEN OLD.source IN (
           'weather','news','octopus','stationhead','environment'
         ) THEN OLD.version ELSE 0 END),
         environment_version = CASE WHEN OLD.source='environment' THEN 0 ELSE environment_version END,
         environment_fetched_at = CASE WHEN OLD.source='environment' THEN 0 ELSE environment_fetched_at END,
         radar_version = CASE WHEN OLD.source='radar' THEN 0 ELSE radar_version END,
         switchbot_version = CASE WHEN OLD.source='switchbot' THEN 0 ELSE switchbot_version END,
         stationhead_version = CASE WHEN OLD.source='stationhead' THEN 0 ELSE stationhead_version END,
         stationhead_health_version = CASE WHEN OLD.source='stationhead_health' THEN 0 ELSE stationhead_health_version END
   WHERE id=1;
END;

INSERT OR REPLACE INTO schema_meta(key,value)
VALUES('schema_version','20260912-split-switchbot-dashboard-version');
