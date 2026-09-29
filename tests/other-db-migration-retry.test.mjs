import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const provisioner = readFileSync('worker/scripts/provision-other-db.mjs', 'utf8');
const officialPartyMigration = readFileSync(
  'database/other-migrations/039_official_party_materialized_metrics.sql',
  'utf8',
);
const spotifyCatalogMigration = readFileSync(
  'database/other-migrations/044_spotify_catalog_progress.sql',
  'utf8',
);
const spotifyArtistDailyMigration = readFileSync(
  'database/other-migrations/047_spotify_artist_daily_summary.sql',
  'utf8',
);
const spotifyTop10Migration = readFileSync(
  'database/other-migrations/050_spotify_artist_top10_daily.sql',
  'utf8',
);
const spotifyStationheadIdentityMigration = readFileSync(
  'database/other-migrations/052_spotify_stationhead_identity.sql',
  'utf8',
);

test('OTHER_DB provisioning makes migration 039 retry-safe before later migrations run', () => {
  assert.match(
    officialPartyMigration,
    /ALTER TABLE sh_official_broadcast_summary ADD COLUMN listener_min REAL/,
  );
  assert.match(provisioner, /OFFICIAL_PARTY_METRICS_MIGRATION = '039_official_party_materialized_metrics\.sql'/);
  assert.match(provisioner, /PRAGMA table_info\(\$\{tableName\}\)/);
  assert.match(provisioner, /if \(columns\.has\(name\)\) continue/);
  assert.match(provisioner, /ensureOfficialPartyMetricColumns\(\)/);
  assert.match(provisioner, /replace\(\/\^ALTER TABLE sh_official_broadcast_summary ADD COLUMN listener_min REAL/);
  assert.match(provisioner, /`--command=\$\{backfillSql\}`/);
  assert.match(provisioner, /for \(const migrationFile of activeMigrationFiles\) applyMigration\(migrationFile\)/);
});

test('OTHER_DB provisioning makes Spotify catalog progress migration retry-safe', () => {
  assert.match(
    spotifyCatalogMigration,
    /ADD COLUMN catalog_total INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(
    spotifyCatalogMigration,
    /ADD COLUMN catalog_completed INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(provisioner, /SPOTIFY_CATALOG_PROGRESS_MIGRATION = '044_spotify_catalog_progress\.sql'/);
  assert.match(provisioner, /SPOTIFY_COLLECTION_RUNS_TABLE = 'sh_spotify_collection_runs'/);
  assert.match(provisioner, /ensureSpotifyCatalogProgressColumns\(\)/);
  assert.match(provisioner, /\['catalog_total', 'INTEGER NOT NULL DEFAULT 0'\]/);
  assert.match(provisioner, /\['catalog_completed', 'INTEGER NOT NULL DEFAULT 0'\]/);
  assert.match(provisioner, /migrationFile === SPOTIFY_CATALOG_PROGRESS_MIGRATION/);
  assert.match(provisioner, /ALTER TABLE \$\{SPOTIFY_COLLECTION_RUNS_TABLE\} ADD COLUMN \$\{name\} \$\{type\}/);
});

test('Spotify Top 10 summary migration is safe to replay during full provisioning', () => {
  assert.match(spotifyArtistDailyMigration, /top10_delta INTEGER/);
  assert.match(spotifyArtistDailyMigration, /top10_year_delta INTEGER/);
  assert.doesNotMatch(spotifyTop10Migration, /ALTER TABLE sh_spotify_artist_daily ADD COLUMN/);
  assert.match(spotifyTop10Migration, /UPDATE sh_spotify_artist_daily/);
});

test('Spotify Stationhead identity migration is safe to replay during full provisioning', () => {
  assert.match(
    spotifyStationheadIdentityMigration,
    /ALTER TABLE sh_spotify_track_aliases\s+ADD COLUMN stationhead_track_id INTEGER/,
  );
  assert.match(provisioner, /SPOTIFY_STATIONHEAD_IDENTITY_MIGRATION = '052_spotify_stationhead_identity\.sql'/);
  assert.match(provisioner, /SPOTIFY_TRACK_ALIASES_TABLE = 'sh_spotify_track_aliases'/);
  assert.match(provisioner, /ensureSpotifyStationheadIdentityColumn\(\)/);
  assert.match(provisioner, /columns\.has\('stationhead_track_id'\)/);
  assert.match(provisioner, /migrationFile === SPOTIFY_STATIONHEAD_IDENTITY_MIGRATION/);
  assert.match(provisioner, /ADD COLUMN stationhead_track_id INTEGER/);
  assert.match(provisioner, /`--command=\$\{remainderSql\}`/);
});

test('OTHER_DB provisioning tolerates Wrangler losing a completed file-import status', () => {
  assert.match(provisioner, /function completedRemoteFileImportDespiteWranglerRace\(error, args\)/);
  assert.match(provisioner, /args\.includes\('--file'\)/);
  assert.match(provisioner, /Not currently importing anything\./);
  assert.match(provisioner, /Processed\\s\+\\d\+\\s\+queries\?/);
  assert.match(provisioner, /continuing after confirmed processed queries/);
  assert.match(provisioner, /return String\(error\.stdout \|\| ''\)/);
});
