const JST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const STATIONHEAD_WEEKLY_CANDIDATE_KEY =
  "diagnostics/stationhead-leaderboard/weekly-candidate/latest.json";
export const STATIONHEAD_WEEKLY_RANKING_TYPE = "週間リーダーボード";
export const STATIONHEAD_WEEKLY_SOURCE = "Stationhead Weekly Leaderboard (R2)";

const MIN_RANKING_ROWS = 5;

type WeeklyWindow = {
  rankingDate: string;
  startMs: number;
  endMs: number;
};

type ProbeRecord = {
  observed_at?: unknown;
  source?: unknown;
  status?: unknown;
  body?: unknown;
};

type ProbePayload = {
  version?: unknown;
  received_at?: unknown;
  digest?: unknown;
  records?: unknown;
};

type Snapshot = {
  schema?: unknown;
  captured_at?: unknown;
  signed_in?: unknown;
  leaderboard_ready?: unknown;
  rows?: unknown;
  lines?: unknown;
};

export type StationheadWeeklyRankingRow = {
  rank: number;
  channelName: string;
  channelAlias: string | null;
  listenerCount: number | null;
  memberCount: number | null;
  totalListens: number | null;
  sourceRow: number;
  cells: string[];
};

type ParsedCandidate = {
  digest: string;
  observedAt: number;
  rows: StationheadWeeklyRankingRow[];
};

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function shiftedMondayWindow(shiftedTimestampMs: number): WeeklyWindow {
  const current = new Date(shiftedTimestampMs);
  const day = current.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const mondayShifted = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() - daysSinceMonday,
  );
  const monday = new Date(mondayShifted);
  const rankingDate = `${monday.getUTCFullYear()}-${twoDigits(monday.getUTCMonth() + 1)}-${twoDigits(monday.getUTCDate())}`;
  return {
    rankingDate,
    startMs: mondayShifted + 18 * HOUR_MS - JST_MS,
    endMs: mondayShifted + 2 * DAY_MS - JST_MS,
  };
}

/** Candidate captures are accepted from Monday 18:00 JST through Wednesday 00:00 JST. */
export function stationheadLeaderboardCandidateWindow(timestampMs: number): WeeklyWindow | null {
  if (!Number.isFinite(timestampMs)) return null;
  const shifted = timestampMs + JST_MS;
  const window = shiftedMondayWindow(shifted);
  return timestampMs >= window.startMs && timestampMs < window.endMs ? window : null;
}

/** The hourly scheduler imports once, at Wednesday 00:00 JST. */
export function stationheadLeaderboardImportWindow(scheduledTimeMs: number): WeeklyWindow | null {
  if (!Number.isFinite(scheduledTimeMs)) return null;
  const shifted = new Date(scheduledTimeMs + JST_MS);
  if (shifted.getUTCDay() !== 3 || shifted.getUTCHours() !== 0) return null;
  const wednesdayShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  const mondayShifted = wednesdayShifted - 2 * DAY_MS;
  const monday = new Date(mondayShifted);
  return {
    rankingDate: `${monday.getUTCFullYear()}-${twoDigits(monday.getUTCMonth() + 1)}-${twoDigits(monday.getUTCDate())}`,
    startMs: mondayShifted + 18 * HOUR_MS - JST_MS,
    endMs: wednesdayShifted - JST_MS,
  };
}

function normalizedCell(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 160);
}

function headerText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_:/()\-]+/g, " ").trim();
}

function isRankHeader(value: string): boolean {
  const text = headerText(value);
  return text === "#" || text === "rank" || text === "順位" || text === "ranking";
}

function isNameHeader(value: string): boolean {
  const text = headerText(value);
  return ["channel", "station", "host", "name", "チャンネル", "ステーション", "ホスト"].some((token) => text.includes(token));
}

function isListenerHeader(value: string): boolean {
  const text = headerText(value);
  return text.includes("listener") || text.includes("リスナー") || text.includes("同接");
}

function isMemberHeader(value: string): boolean {
  const text = headerText(value);
  return text.includes("member") || text.includes("メンバー");
}

function isTotalListensHeader(value: string): boolean {
  const text = headerText(value);
  return text.includes("total listen") || text.includes("total play") || text.includes("total stream")
    || text.includes("総再生") || text === "再生数";
}

function parseRank(value: string): number | null {
  const match = value.match(/^#?\s*(\d{1,3})\s*$/);
  if (!match) return null;
  const rank = Number(match[1]);
  return Number.isInteger(rank) && rank >= 1 && rank <= 999 ? rank : null;
}

function parseMetric(value: string): number | null {
  const text = value.normalize("NFKC").replace(/,/g, "").trim();
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*(K|M|B|万|億)?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base < 0) return null;
  const suffix = String(match[2] || "").toUpperCase();
  const multiplier = suffix === "K" ? 1_000
    : suffix === "M" ? 1_000_000
      : suffix === "B" ? 1_000_000_000
        : suffix === "万" ? 10_000
          : suffix === "億" ? 100_000_000
            : 1;
  const result = Math.round(base * multiplier);
  return Number.isSafeInteger(result) ? result : null;
}

function nameAndAlias(value: string): { name: string; alias: string | null } | null {
  const clean = normalizedCell(value);
  if (!clean || isRankHeader(clean) || /^[-–—]+$/.test(clean)) return null;
  const aliasMatch = clean.match(/@([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})/);
  const alias = aliasMatch?.[1] ?? null;
  const withoutAlias = aliasMatch ? clean.replace(aliasMatch[0], "").replace(/[·|•\-]+$/g, "").trim() : clean;
  const name = withoutAlias || alias || "";
  return name ? { name: name.slice(0, 160), alias } : null;
}

function headerIndices(rows: string[][]): {
  rowIndex: number;
  rank: number;
  name: number;
  listeners: number;
  members: number;
  totalListens: number;
} | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 5); rowIndex += 1) {
    const row = rows[rowIndex];
    const rank = row.findIndex(isRankHeader);
    const name = row.findIndex(isNameHeader);
    if (rank < 0 || name < 0) continue;
    return {
      rowIndex,
      rank,
      name,
      listeners: row.findIndex(isListenerHeader),
      members: row.findIndex(isMemberHeader),
      totalListens: row.findIndex(isTotalListensHeader),
    };
  }
  return null;
}

function candidateNameIndex(cells: string[], rankIndex: number): number {
  for (let index = 0; index < cells.length; index += 1) {
    if (index === rankIndex) continue;
    const cell = cells[index];
    if (!cell || parseRank(cell) !== null) continue;
    if (/^(listeners?|members?|plays?|streams?|total|リスナー|メンバー|再生)/i.test(cell)) continue;
    if (/^\d[\d,.]*\s*(?:K|M|B|万|億)?$/i.test(cell)) continue;
    return index;
  }
  return -1;
}

export function parseStationheadLeaderboardSnapshot(value: unknown): StationheadWeeklyRankingRow[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const snapshot = value as Snapshot;
  if (Number(snapshot.schema) !== 2 || snapshot.signed_in !== true || snapshot.leaderboard_ready !== true) return [];
  if (!Array.isArray(snapshot.rows)) return [];

  const rows = snapshot.rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.slice(0, 12).map(normalizedCell));
  const header = headerIndices(rows);
  const parsed = new Map<number, StationheadWeeklyRankingRow>();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (header && rowIndex === header.rowIndex) continue;
    const cells = rows[rowIndex];
    if (!cells.length) continue;

    let rankIndex = header?.rank ?? -1;
    let rank = rankIndex >= 0 ? parseRank(cells[rankIndex] || "") : null;
    if (rank === null) {
      rankIndex = cells.findIndex((cell) => parseRank(cell) !== null);
      rank = rankIndex >= 0 ? parseRank(cells[rankIndex]) : null;
    }
    if (rank === null || parsed.has(rank)) continue;

    const nameIndex = header?.name ?? candidateNameIndex(cells, rankIndex);
    if (nameIndex < 0 || nameIndex >= cells.length) continue;
    const identity = nameAndAlias(cells[nameIndex]);
    if (!identity) continue;

    const metricAt = (index: number): number | null => index >= 0 && index < cells.length ? parseMetric(cells[index]) : null;
    parsed.set(rank, {
      rank,
      channelName: identity.name,
      channelAlias: identity.alias,
      listenerCount: metricAt(header?.listeners ?? -1),
      memberCount: metricAt(header?.members ?? -1),
      totalListens: metricAt(header?.totalListens ?? -1),
      sourceRow: rowIndex + 1,
      cells: cells.map((cell) => cell.slice(0, 120)),
    });
  }

  return [...parsed.values()].sort((a, b) => a.rank - b.rank);
}

function parseProbeCandidate(raw: unknown, window: WeeklyWindow): ParsedCandidate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = raw as ProbePayload;
  const receivedAt = Number(payload.received_at);
  if (Number(payload.version) !== 1 || !Number.isSafeInteger(receivedAt)) return null;
  if (receivedAt < window.startMs || receivedAt >= window.endMs) return null;
  const digest = String(payload.digest ?? "").trim();
  if (!/^[a-f0-9]{32,64}$/i.test(digest)) return null;
  if (!Array.isArray(payload.records)) return null;

  let selected: ParsedCandidate | null = null;
  for (const rawRecord of payload.records) {
    if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) continue;
    const record = rawRecord as ProbeRecord;
    if (String(record.source ?? "") !== "dedicated-webview-dom" || Number(record.status) !== 200) continue;
    const observedAt = Number(record.observed_at);
    if (!Number.isSafeInteger(observedAt) || observedAt < window.startMs || observedAt >= window.endMs) continue;
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(String(record.body ?? ""));
    } catch {
      continue;
    }
    const rows = parseStationheadLeaderboardSnapshot(snapshot);
    if (rows.length < MIN_RANKING_ROWS || rows[0]?.rank !== 1) continue;
    if (!selected || observedAt > selected.observedAt) selected = { digest, observedAt, rows };
  }
  return selected;
}

export function hasUsableStationheadWeeklyCandidate(raw: unknown, timestampMs: number): boolean {
  const window = stationheadLeaderboardCandidateWindow(timestampMs);
  return !!window && !!parseProbeCandidate(raw, window);
}

async function readCandidate(bucket: R2Bucket, window: WeeklyWindow): Promise<ParsedCandidate | null> {
  const object = await bucket.get(STATIONHEAD_WEEKLY_CANDIDATE_KEY);
  if (!object) return null;
  try {
    return parseProbeCandidate(JSON.parse(await object.text()), window);
  } catch {
    return null;
  }
}

export async function importStationheadLeaderboardWeekly(
  env: { DATA_BUCKET?: R2Bucket; OTHER_DB?: D1Database },
  scheduledTimeMs: number,
): Promise<{ status: string; rankingDate?: string; rows?: number; digest?: string }> {
  const window = stationheadLeaderboardImportWindow(scheduledTimeMs);
  if (!window) return { status: "not-due" };
  if (!env.DATA_BUCKET) throw new Error("Stationhead weekly import requires DATA_BUCKET");
  if (!env.OTHER_DB) throw new Error("Stationhead weekly import requires OTHER_DB");

  const candidate = await readCandidate(env.DATA_BUCKET, window);
  if (!candidate) {
    console.warn("stationhead-weekly-import-no-candidate", {
      rankingDate: window.rankingDate,
      start: new Date(window.startMs).toISOString(),
      end: new Date(window.endMs).toISOString(),
    });
    return { status: "no-candidate", rankingDate: window.rankingDate };
  }

  const importedAt = scheduledTimeMs;
  const flags = JSON.stringify(["stationhead_r2", "weekly_snapshot", "deduped"]);
  const statements = [
    env.OTHER_DB.prepare(
      "DELETE FROM sh_channel_rankings WHERE ranking_date=? AND ranking_type=?",
    ).bind(window.rankingDate, STATIONHEAD_WEEKLY_RANKING_TYPE),
    ...candidate.rows.map((row) => env.OTHER_DB!.prepare(`INSERT INTO sh_channel_rankings (
      ranking_date,observed_at,ranking_type,rank,channel_name,channel_alias,
      listener_count,member_count,total_listens,source_sheet,source_row,
      quality_score,quality_flags,raw_json,imported_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      window.rankingDate,
      candidate.observedAt,
      STATIONHEAD_WEEKLY_RANKING_TYPE,
      row.rank,
      row.channelName,
      row.channelAlias,
      row.listenerCount,
      row.memberCount,
      row.totalListens,
      STATIONHEAD_WEEKLY_SOURCE,
      row.sourceRow,
      1,
      flags,
      JSON.stringify({
        schema: 1,
        source: "stationhead-r2-leaderboard",
        source_digest: candidate.digest,
        captured_at: candidate.observedAt,
        cells: row.cells,
      }),
      importedAt,
    )),
  ];

  await env.OTHER_DB.batch(statements);
  console.log("stationhead-weekly-import-complete", {
    rankingDate: window.rankingDate,
    rows: candidate.rows.length,
    digest: candidate.digest.slice(0, 16),
  });
  return {
    status: "imported",
    rankingDate: window.rankingDate,
    rows: candidate.rows.length,
    digest: candidate.digest,
  };
}
