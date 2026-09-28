import type { Env } from "./sources";
import { applySpotifyArtistChartInput, type SpotifyArtistChartInputResult } from "./spotify_artist_chart_capture";
import { syncSpotifyArtistChartR2ToD1 } from "./spotify_artist_chart_read";

const PREFIX = "spotify/charts/artist-jp-daily/";
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const READ_MODEL_REFRESH_TYPE = "spotify-read-model-refresh";

type SpotifyChartEventEnv = Env & {
  SPOTIFY_PLAYCOUNT_QUEUE?: Queue;
};

type ChartRecord = Record<string, unknown>;

function chartRecords(value: unknown): ChartRecord[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const records: ChartRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as ChartRecord;
    const chartDate = String(record.chart_date ?? "").trim();
    if (!DATE_KEY.test(chartDate)) return null;
    records.push(record);
  }
  return records;
}

async function requestReadModelRefresh(env: SpotifyChartEventEnv, chartDate: string): Promise<void> {
  if (!env.SPOTIFY_PLAYCOUNT_QUEUE) return;
  await env.SPOTIFY_PLAYCOUNT_QUEUE.send({
    message_type: READ_MODEL_REFRESH_TYPE,
    message_version: 1,
    reason: "artist-chart",
    chart_date: chartDate,
  });
}

export async function ingestSpotifyArtistChartInput(
  value: unknown,
  env: SpotifyChartEventEnv,
): Promise<SpotifyArtistChartInputResult> {
  const records = chartRecords(value);
  const bucket = env.DATA_BUCKET;
  if (!records || !bucket) return applySpotifyArtistChartInput(value, env);

  const fresh: ChartRecord[] = [];
  let deduplicated = 0;
  for (const record of records) {
    const chartDate = String(record.chart_date);
    const existing = await bucket.head(`${PREFIX}${chartDate}.json`);
    if (existing) deduplicated += 1;
    else fresh.push(record);
  }

  let result: SpotifyArtistChartInputResult;
  if (fresh.length) {
    result = await applySpotifyArtistChartInput(fresh, env);
  } else {
    const sync = await syncSpotifyArtistChartR2ToD1(env);
    result = {
      status: 200,
      body: {
        accepted: records.length,
        stored: false,
        deduplicated,
        reported: true,
        chartDate: String(records.at(-1)?.chart_date ?? ""),
        latestUpdated: false,
        d1Synced: sync.synced,
        d1Backfilled: sync.backfilled,
        d1Days: sync.days,
        d1Rows: sync.rows,
        delivery: "r2-d1-read-model",
      },
    };
  }

  if (result.status !== 200) return result;
  const body = {
    ...result.body,
    accepted: records.length,
    deduplicated: Number(result.body.deduplicated ?? 0) + deduplicated,
  };
  const d1Days = Number(body.d1Days ?? 0);
  if (d1Days > 0) {
    await requestReadModelRefresh(env, String(body.chartDate ?? records.at(-1)?.chart_date ?? ""));
  }
  return { status: 200, body };
}
