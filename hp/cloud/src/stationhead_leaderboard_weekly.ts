const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONDAY_NIGHT_LOCAL_HOUR = 18;
const EXPECTED_WEEKLY_ROWS = 100;

export const STATIONHEAD_WEEKLY_CANDIDATE_PREFIX = "diagnostics/stationhead-leaderboard/weekly/";

export interface StationheadWeeklyLeaderboardRow {
  rank: number;
  channel_name: string;
}

export interface StationheadWeeklyLeaderboardCandidate {
  version: 1;
  ranking_date: string;
  observed_at: number;
  digest: string;
  row_count: number;
  rows: StationheadWeeklyLeaderboardRow[];
}

interface ProbeRecordLike {
  observed_at: number;
  source: string;
  status: number;
  body: string;
}

type JsonRecord = Record<string, unknown>;

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function mondayFromIsoDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return isoDate(date);
}

export function stationheadWeeklyRankingDate(observedAt: number): string | null {
  if (!Number.isSafeInteger(observedAt) || observedAt <= 0) return null;
  const local = new Date(observedAt + JST_OFFSET_MS);
  return mondayFromIsoDate(isoDate(local));
}

export function stationheadWeeklyWindow(rankingDate: string): { start: number; end: number } | null {
  const monday = mondayFromIsoDate(rankingDate);
  if (!monday || monday !== rankingDate) return null;
  const mondayUtcCalendar = Date.parse(`${monday}T00:00:00Z`);
  if (!Number.isFinite(mondayUtcCalendar)) return null;
  // Monday 18:00 JST through Wednesday 00:00 JST (all of Tuesday).
  return {
    start: mondayUtcCalendar + (MONDAY_NIGHT_LOCAL_HOUR * 60 * 60 * 1000) - JST_OFFSET_MS,
    end: mondayUtcCalendar + (2 * DAY_MS) - JST_OFFSET_MS,
  };
}

function normalizedHandle(value: unknown): string | null {
  const text = String(value ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(text)) return null;
  return text;
}

function normalizedRank(value: unknown): number | null {
  const rank = Number(value);
  return Number.isSafeInteger(rank) && rank >= 1 && rank <= EXPECTED_WEEKLY_ROWS ? rank : null;
}

function directRows(value: unknown): StationheadWeeklyLeaderboardRow[] {
  if (!Array.isArray(value)) return [];
  const rows: StationheadWeeklyLeaderboardRow[] = [];
  for (const item of value.slice(0, EXPECTED_WEEKLY_ROWS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as JsonRecord;
    const rank = normalizedRank(row.rank);
    const channel = normalizedHandle(row.channel_name ?? row.host ?? row.handle ?? row.name);
    if (rank == null || channel == null) continue;
    rows.push({ rank, channel_name: channel });
  }
  return rows;
}

function rowsFromLines(value: unknown): StationheadWeeklyLeaderboardRow[] {
  if (!Array.isArray(value)) return [];
  const lines = value
    .slice(0, 1_600)
    .map(item => String(item ?? "").trim())
    .filter(Boolean);
  const rows: StationheadWeeklyLeaderboardRow[] = [];
  let expectedRank = 1;
  for (let index = 0; index < lines.length && expectedRank <= EXPECTED_WEEKLY_ROWS; index += 1) {
    if (lines[index] !== String(expectedRank)) continue;
    let channel: string | null = null;
    for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 8); lookahead += 1) {
      const candidateLine = lines[lookahead];
      if (candidateLine === undefined) continue;
      channel = normalizedHandle(candidateLine);
      if (channel && candidateLine.startsWith("@")) break;
      channel = null;
    }
    if (!channel) continue;
    rows.push({ rank: expectedRank, channel_name: channel });
    expectedRank += 1;
  }
  return rows;
}

function completeRows(rows: StationheadWeeklyLeaderboardRow[]): StationheadWeeklyLeaderboardRow[] | null {
  if (rows.length !== EXPECTED_WEEKLY_ROWS) return null;
  const byRank = new Map<number, StationheadWeeklyLeaderboardRow>();
  const hosts = new Set<string>();
  for (const row of rows) {
    if (byRank.has(row.rank) || hosts.has(row.channel_name)) return null;
    byRank.set(row.rank, row);
    hosts.add(row.channel_name);
  }
  const ordered: StationheadWeeklyLeaderboardRow[] = [];
  for (let rank = 1; rank <= EXPECTED_WEEKLY_ROWS; rank += 1) {
    const row = byRank.get(rank);
    if (!row) return null;
    ordered.push(row);
  }
  return ordered;
}

export function stationheadWeeklyRowsFromBody(body: string): StationheadWeeklyLeaderboardRow[] | null {
  let snapshot: JsonRecord;
  try {
    const parsed = JSON.parse(String(body || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    snapshot = parsed as JsonRecord;
  } catch {
    return null;
  }
  if (snapshot.signed_in === false) return null;
  const path = String(snapshot.path ?? "");
  if (path && !/^\/leaderboard\/?$/i.test(path)) return null;

  const sources = [snapshot.leaderboard, snapshot.ranking];
  for (const source of sources) {
    const rows = completeRows(directRows(source));
    if (rows) return rows;
  }
  return completeRows(rowsFromLines(snapshot.lines));
}

export function stationheadWeeklyCandidateFromRecords(
  records: ProbeRecordLike[],
  digest: string,
): StationheadWeeklyLeaderboardCandidate | null {
  if (!/^[a-f0-9]{64}$/i.test(String(digest || ""))) return null;
  let selected: StationheadWeeklyLeaderboardCandidate | null = null;
  for (const record of records) {
    if (record.source !== "dedicated-webview-dom" || record.status !== 200) continue;
    const rankingDate = stationheadWeeklyRankingDate(record.observed_at);
    if (!rankingDate) continue;
    const window = stationheadWeeklyWindow(rankingDate);
    if (!window || record.observed_at < window.start || record.observed_at >= window.end) continue;
    const rows = stationheadWeeklyRowsFromBody(record.body);
    if (!rows) continue;
    const candidate: StationheadWeeklyLeaderboardCandidate = {
      version: 1,
      ranking_date: rankingDate,
      observed_at: record.observed_at,
      digest: digest.toLowerCase(),
      row_count: rows.length,
      rows,
    };
    if (!selected || candidate.observed_at > selected.observed_at) selected = candidate;
  }
  return selected;
}

export function stationheadWeeklyCandidateKey(rankingDate: string): string {
  const monday = mondayFromIsoDate(rankingDate);
  if (!monday || monday !== rankingDate) throw new Error("ranking_date must be a Monday YYYY-MM-DD");
  return `${STATIONHEAD_WEEKLY_CANDIDATE_PREFIX}${rankingDate}.json`;
}
