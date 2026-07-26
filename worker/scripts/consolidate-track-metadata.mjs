import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  metadataValuePresent,
  normalizedIsrc,
} from './track-metadata-consolidation-lib.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const sourceDatabase = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const targetDatabase = process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies';
const configuredPageSize = Number(process.env.TRACK_METADATA_PAGE_SIZE || 25);
const pageSize = Number.isFinite(configuredPageSize)
  ? Math.max(1, Math.min(100, Math.trunc(configuredPageSize)))
  : 25;
const apply = String(process.env.TRACK_METADATA_APPLY || '').toLowerCase() === 'true';
const dropSource = String(process.env.TRACK_METADATA_DROP_SOURCE || '').toLowerCase() === 'true';
const columns = [
  'spotify_id', 'isrc', 'title', 'artist', 'display_title', 'thumbnail_url',
  'spotify_url', 'source', 'fetched_at', 'raw_json',
];
const mergeColumns = columns.filter((column) => !['spotify_id', 'fetched_at'].includes(column));

if (dropSource && !apply) {
  throw new Error('TRACK_METADATA_DROP_SOURCE=true requires TRACK_METADATA_APPLY=true');
}

function wrangler(args) {
  return execFileSync(process.execPath, [wranglerScript, ...args], {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(Math.min(...starts)));
}

function rowsFrom(payload) {
  const containers = Array.isArray(payload) ? payload : [payload];
  return containers.flatMap((container) => (
    container?.results || container?.result?.[0]?.results || container?.result?.results || []
  ));
}

function execute(database, command) {
  return parseJsonOutput(wrangler([
    'd1', 'execute', database,
    '--remote', '--yes', '--json', '--command', command,
  ]));
}

function executeDdl(database, command) {
  wrangler([
    'd1', 'execute', database,
    '--remote', '--yes', '--command', command,
  ]);
}

function countRows(database) {
  const rows = rowsFrom(execute(database, 'SELECT COUNT(*) AS row_count FROM sh_track_metadata'));
  return Number(rows[0]?.row_count || 0);
}

function tableExists(database) {
  const rows = rowsFrom(execute(
    database,
    "SELECT COUNT(*) AS object_count FROM sqlite_schema WHERE type='table' AND name='sh_track_metadata'",
  ));
  return Number(rows[0]?.object_count || 0) > 0;
}

function quote(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll('\u0000', '').replaceAll("'", "''")}'`;
}

function sourcePage(offset) {
  return rowsFrom(execute(
    sourceDatabase,
    `SELECT ${columns.join(',')} FROM sh_track_metadata
     ORDER BY spotify_id LIMIT ${pageSize} OFFSET ${offset}`,
  ));
}

function presentSql(reference) {
  return `${reference} IS NOT NULL AND TRIM(${reference})<>''`;
}

function mergeColumnSql(column) {
  const existing = `sh_track_metadata.${column}`;
  const incoming = `excluded.${column}`;
  return `${column}=CASE
  WHEN excluded.fetched_at>=sh_track_metadata.fetched_at THEN
    CASE WHEN ${presentSql(incoming)} THEN ${incoming} ELSE ${existing} END
  ELSE
    CASE WHEN ${presentSql(existing)} THEN ${existing} ELSE ${incoming} END
  END`;
}

function writePage(database, rows, directory, page) {
  const updates = [
    ...mergeColumns.map(mergeColumnSql),
    'fetched_at=MAX(sh_track_metadata.fetched_at,excluded.fetched_at)',
  ];
  const statements = rows.map((row) => `INSERT INTO sh_track_metadata(${columns.join(',')}) VALUES(${columns.map((column) => quote(row[column])).join(',')})
ON CONFLICT(spotify_id) DO UPDATE SET
  ${updates.join(',\n  ')};`);
  const sqlPath = join(directory, `track-metadata-${page}.sql`);
  writeFileSync(sqlPath, `${statements.join('\n')}\n`, 'utf8');
  wrangler([
    'd1', 'execute', database,
    '--remote', '--yes', '--file', sqlPath,
  ]);
}

function sameMetadataValue(column, actualValue, sourceValue) {
  if (column === 'isrc') return normalizedIsrc(actualValue) === normalizedIsrc(sourceValue);
  return String(actualValue) === String(sourceValue);
}

function verifyPage(database, sourceRows) {
  const expected = new Map(sourceRows
    .map((row) => [String(row.spotify_id || '').trim(), row])
    .filter(([spotifyId]) => spotifyId));
  if (expected.size !== sourceRows.length) {
    throw new Error('Source metadata contains a row without spotify_id or a duplicate spotify_id');
  }
  if (!expected.size) return { rows: 0, isrcRows: 0 };

  const ids = [...expected.keys()];
  const rows = rowsFrom(execute(
    database,
    `SELECT ${columns.join(',')} FROM sh_track_metadata
     WHERE spotify_id IN (${ids.map(quote).join(',')})`,
  ));
  const actual = new Map(rows.map((row) => [
    String(row.spotify_id || '').trim(),
    row,
  ]));
  let verifiedIsrcRows = 0;
  for (const [spotifyId, sourceRow] of expected) {
    const actualRow = actual.get(spotifyId);
    if (!actualRow) {
      throw new Error(`Target metadata row missing for spotify_id=${spotifyId}`);
    }

    const sourceFetchedAt = Number(sourceRow.fetched_at || 0);
    const actualFetchedAt = Number(actualRow.fetched_at || 0);
    if (!Number.isFinite(actualFetchedAt) || actualFetchedAt < sourceFetchedAt) {
      throw new Error(`Target metadata fetched_at is older for spotify_id=${spotifyId}`);
    }

    for (const column of mergeColumns) {
      const sourceValue = sourceRow[column];
      if (!metadataValuePresent(sourceValue)) continue;
      if (!metadataValuePresent(actualRow[column])) {
        throw new Error(`Target metadata ${column} missing for spotify_id=${spotifyId}`);
      }
      if (sourceFetchedAt >= actualFetchedAt
          && !sameMetadataValue(column, actualRow[column], sourceValue)) {
        throw new Error(`Target metadata ${column} mismatch for spotify_id=${spotifyId}`);
      }
    }
    if (metadataValuePresent(sourceRow.isrc)) verifiedIsrcRows += 1;
  }
  return { rows: expected.size, isrcRows: verifiedIsrcRows };
}

function dropSourceTable() {
  executeDdl(sourceDatabase, 'DROP TABLE IF EXISTS sh_track_metadata');
  if (tableExists(sourceDatabase)) {
    throw new Error('Legacy OTHER_DB sh_track_metadata table still exists after DROP TABLE');
  }
}

let sourceCount;
try {
  sourceCount = countRows(sourceDatabase);
} catch (error) {
  if (/no such table:\s*sh_track_metadata/i.test(String(error?.message || error))) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'source-table-missing' }));
    process.exit(0);
  }
  throw error;
}

const targetBefore = countRows(targetDatabase);
if (!apply) {
  console.log(JSON.stringify({
    ok: true,
    applied: false,
    source_database: sourceDatabase,
    target_database: targetDatabase,
    source_rows: sourceCount,
    target_rows_before: targetBefore,
    drop_source: false,
  }));
  process.exit(0);
}

if (sourceCount === 0) {
  if (dropSource) dropSourceTable();
  console.log(JSON.stringify({
    ok: true,
    applied: true,
    source_database: sourceDatabase,
    target_database: targetDatabase,
    source_rows: 0,
    copied_rows: 0,
    verified_rows: 0,
    verified_isrc_rows: 0,
    target_rows_before: targetBefore,
    target_rows_after: targetBefore,
    drop_source: dropSource,
  }));
  process.exit(0);
}

const tempDirectory = mkdtempSync(join(workerRoot, '.track-metadata-'));
try {
  let copied = 0;
  let verifiedRows = 0;
  let verifiedIsrcRows = 0;
  for (let offset = 0, page = 0; offset < sourceCount; offset += pageSize, page += 1) {
    const rows = sourcePage(offset);
    if (!rows.length) break;
    writePage(targetDatabase, rows, tempDirectory, page);
    const verification = verifyPage(targetDatabase, rows);
    verifiedRows += verification.rows;
    verifiedIsrcRows += verification.isrcRows;
    copied += rows.length;
  }

  if (copied !== sourceCount || verifiedRows !== sourceCount) {
    throw new Error(`Metadata consolidation incomplete: source=${sourceCount}, copied=${copied}, verified=${verifiedRows}`);
  }
  const targetAfter = countRows(targetDatabase);
  if (targetAfter < sourceCount) {
    throw new Error(`Target metadata count ${targetAfter} is smaller than source count ${sourceCount}`);
  }
  if (dropSource) dropSourceTable();
  console.log(JSON.stringify({
    ok: true,
    applied: true,
    source_database: sourceDatabase,
    target_database: targetDatabase,
    source_rows: sourceCount,
    copied_rows: copied,
    verified_rows: verifiedRows,
    verified_isrc_rows: verifiedIsrcRows,
    target_rows_before: targetBefore,
    target_rows_after: targetAfter,
    drop_source: dropSource,
  }));
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}
