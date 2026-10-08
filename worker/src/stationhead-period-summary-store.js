const COLUMNS = Object.freeze([
  'period_key', 'period_start', 'period_end', 'sample_count',
  'listener_avg', 'listener_min', 'listener_max',
  'stream_start', 'stream_end', 'stream_growth',
  'member_start', 'member_end', 'member_growth', 'updated_at',
]);
const TABLES = Object.freeze({
  daily: Object.freeze({ name: 'sh_daily_summary', condition: '>' }),
  weekly: Object.freeze({ name: 'sh_weekly_summary', condition: '>=' }),
});

export async function upsertStationheadPeriodSummary(db, period, row) {
  const table = TABLES[period];
  if (!table) throw new Error(`unsupported Stationhead summary period: ${String(period)}`);
  if (!row?.period_key) return false;
  if (typeof db?.prepare !== 'function') throw new Error('Stationhead summary D1 binding missing');
  const sql = `INSERT INTO ${table.name}(${COLUMNS.join(',')})
    VALUES(${COLUMNS.map(() => '?').join(',')})
    ON CONFLICT(period_key) DO UPDATE SET
      ${COLUMNS.slice(1).map(column => `${column}=excluded.${column}`).join(',\n      ')}
    WHERE excluded.updated_at${table.condition}${table.name}.updated_at`;
  const values = COLUMNS.map(column => column === 'updated_at'
    ? row.updated_at ?? row.period_end : row[column]);
  await db.prepare(sql).bind(...values).run();
  return true;
}
