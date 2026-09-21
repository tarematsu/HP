import { execFileSync } from 'node:child_process';

const DATABASE = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const TEST_ID = process.env.TEST_ID || 'sakuramankai-20260921-5m-v3';
const EXPECTED_HANDLE = 'sakuramankai';
const EXPECTED_DURATION_MS = 300_000;
const POLL_MS = 15_000;
const MAX_POLLS = 44;

function parseWranglerJson(output) {
  const text = String(output || '').trim();
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '[' && text[i] !== '{') continue;
    try { return JSON.parse(text.slice(i)); } catch {}
  }
  throw new Error(`invalid Wrangler JSON: ${text.slice(0, 500)}`);
}

function collectEntries(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (Array.isArray(value)) {
    for (const item of value) collectEntries(item, result);
    return result;
  }
  if (Array.isArray(value.result)) return collectEntries(value.result, result);
  if (value.result && typeof value.result === 'object') return collectEntries(value.result, result);
  if (Array.isArray(value.results)) result.push(value);
  return result;
}

function query(sql) {
  const output = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DATABASE,
    '--remote', '--yes', '--json', '--command', sql,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const entries = collectEntries(parseWranglerJson(output));
  if (!entries.length) throw new Error('Wrangler returned no D1 result');
  return entries.flatMap((entry) => entry.results || []);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`;

function testRow() {
  return query(`SELECT test_id,target_handle,started_at,ends_at,status,updated_at
    FROM sh_sakurazaka46jp_collection_tests
    WHERE test_id=${quoted(TEST_ID)} LIMIT 1`)[0] || null;
}

let test = null;
for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
  test = testRow();
  const now = Date.now();
  console.log(JSON.stringify({
    event: 'sakuramankai_v3_poll', poll, now,
    found: Boolean(test), status: test?.status || null,
    started_at: Number(test?.started_at) || null,
    ends_at: Number(test?.ends_at) || null,
  }));
  if (test && now >= Number(test.ends_at) + 15_000) break;
  if (poll < MAX_POLLS) await sleep(POLL_MS);
}

if (!test) throw new Error(`test row not found: ${TEST_ID}`);
if (test.target_handle !== EXPECTED_HANDLE) throw new Error(`unexpected target ${test.target_handle}`);
const startedAt = Number(test.started_at);
const endsAt = Number(test.ends_at);
if (endsAt - startedAt !== EXPECTED_DURATION_MS) throw new Error(`unexpected duration ${endsAt - startedAt}`);
if (Date.now() < endsAt) throw new Error('test window has not completed');

const main = query(`SELECT observed_at,observed_minute,station_id,broadcast_id,broadcast_start_time,
    is_broadcasting,listener_count,guest_count,total_listens,status,chat_status,channel_id,channel_alias,
    json_valid(raw_json) AS raw_valid,length(raw_json) AS raw_bytes
  FROM sh_sakurazaka46jp_main
  WHERE observed_at>=${startedAt} AND observed_at<${endsAt}
  ORDER BY observed_at ASC,id ASC`);
const chats = query(`SELECT observed_at,observed_minute,station_id,
    json_valid(raw_json) AS raw_valid,length(raw_json) AS raw_bytes
  FROM sh_sakurazaka46jp_chat
  WHERE observed_at>=${startedAt} AND observed_at<${endsAt}
  ORDER BY observed_at ASC,id ASC`);

const distinctMinutes = [...new Set(main.map((row) => Number(row.observed_minute)).filter(Number.isFinite))];
const timestamps = main.map((row) => Number(row.observed_at)).filter(Number.isFinite);
const gapsMs = timestamps.slice(1).map((value, index) => value - timestamps[index]);
const invalidMain = main.filter((row) => Number(row.raw_valid) !== 1);
const invalidChats = chats.filter((row) => Number(row.raw_valid) !== 1);
const outOfWindow = main.filter((row) => Number(row.observed_at) < startedAt || Number(row.observed_at) >= endsAt);

const report = {
  ok: true,
  test,
  main_count: main.length,
  distinct_main_minutes: distinctMinutes.length,
  chat_count: chats.length,
  gaps_ms: gapsMs,
  invalid_main_count: invalidMain.length,
  invalid_chat_count: invalidChats.length,
  out_of_window_count: outOfWindow.length,
  main,
  chats,
};
console.log(`SAKURAMANKAI_V3_REPORT=${JSON.stringify(report)}`);

if (main.length < 5) throw new Error(`only ${main.length} main samples collected`);
if (distinctMinutes.length < 5) throw new Error(`only ${distinctMinutes.length} distinct collection minutes`);
if (gapsMs.some((gap) => gap > 90_000)) throw new Error(`collection gap exceeded 90 seconds: ${JSON.stringify(gapsMs)}`);
if (invalidMain.length) throw new Error(`${invalidMain.length} main raw payloads are invalid JSON`);
if (invalidChats.length) throw new Error(`${invalidChats.length} chat raw payloads are invalid JSON`);
if (outOfWindow.length) throw new Error(`${outOfWindow.length} main rows are outside the test window`);
