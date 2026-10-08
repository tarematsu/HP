import { fetchJson, fetchText } from "./http";
import { numberOrNull, stripHtml } from "./source_parse";
import { JST_MS, type Env, type SourceResult } from "./source_types";

const WEATHER_GROUP = /<div class="wTable__group">([\s\S]*?)(?=<div class="wTable__group">|$)/gi;
const WEATHER_ROW = /<div class="wTable__row">([\s\S]*?)<\/div>\s*(?=<div class="wTable__row">|<\/div>)/gi;
const WEATHER_DAY = /class="wTable__item">(\d{1,2})日/;
const WEATHER_HOUR = /class="wTable__item time">(\d{1,2})</;
const WEATHER_ICON = /wxicon\/(\d+)\.png/i;
const WEATHER_RAIN = /class="wTable__item r">(-?\d+(?:\.\d+)?)/;
const WEATHER_TEMP = /class="wTable__item t">(-?\d+(?:\.\d+)?)/;
const WEATHER_POP = /class="wTable__item (?:p|pop)">\s*(\d{1,3})/i;
const WEATHER_POP_TEXT = /(?:降水確率\s*)?(\d{1,3})\s*%/;
const WEATHER_WINDOW_HOURS = 12;
const HOUR_MS = 60 * 60_000;
const WEATHERNEWS_CURRENT_ENDPOINT = "https://site.weathernews.jp/lba/wxdata/api_data_ss1";
const WEATHERNEWS_COORDINATES = /\/onebox\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)(?:\/|$)/i;
type JsonRecord = Record<string, unknown>;
type WeatherForecast = { forecastDate: string; startHour: number; windowStartAt: string; hourly: Record<string, unknown>; };

function weatherGroupDayStart(day: number, windowStart: number): number | null {
  const anchor = new Date(windowStart); let selected: number | null = null; let selectedDistance = Number.POSITIVE_INFINITY;
  for (let monthOffset = -1; monthOffset <= 1; monthOffset += 1) {
    const candidate = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthOffset, day);
    if (new Date(candidate).getUTCDate() !== day) continue;
    const distance = Math.abs(candidate - windowStart);
    if (distance < selectedDistance) { selected = candidate; selectedDistance = distance; }
  }
  return selected;
}
function weatherDateLabel(timestampMs: number): string { const date = new Date(timestampMs); return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`; }
function weatherWindow(now: Date) {
  const localStart = Math.floor((now.getTime() + JST_MS) / HOUR_MS) * HOUR_MS;
  const localEnd = localStart + WEATHER_WINDOW_HOURS * HOUR_MS;
  const endDate = new Date(localEnd - HOUR_MS); const startDate = new Date(localStart);
  const startLabel = weatherDateLabel(localStart); const endLabel = weatherDateLabel(localEnd - HOUR_MS);
  return { localStart, localEnd, actualStart: localStart - JST_MS, actualEnd: localEnd - JST_MS,
    forecastDate: startDate.getUTCDate() === endDate.getUTCDate() && startDate.getUTCMonth() === endDate.getUTCMonth() ? startLabel : `${startLabel}〜${endLabel}`,
    startHour: startDate.getUTCHours(), windowStartAt: new Date(localStart - JST_MS).toISOString() };
}
function parseWeatherNews(html: string, now = new Date()): WeatherForecast {
  const bodyStart = html.indexOf('id="flick_list"'); if (bodyStart < 0) throw new Error("WeatherNews hourly table was not found");
  const window = weatherWindow(now); const hourly: Record<string, unknown> = {}; let hourlyCount = 0;
  WEATHER_GROUP.lastIndex = bodyStart;
  for (let groupMatch = WEATHER_GROUP.exec(html); groupMatch; groupMatch = WEATHER_GROUP.exec(html)) {
    const content = groupMatch[1] ?? ""; const day = numberOrNull(WEATHER_DAY.exec(content)?.[1]); if (day === null) continue;
    const groupStart = weatherGroupDayStart(day, window.localStart); if (groupStart === null) continue;
    WEATHER_ROW.lastIndex = 0;
    for (let rowMatch = WEATHER_ROW.exec(content); rowMatch; rowMatch = WEATHER_ROW.exec(content)) {
      const row = rowMatch[1] ?? ""; const hour = numberOrNull(WEATHER_HOUR.exec(row)?.[1]); if (hour === null) continue;
      const timestamp = groupStart + hour * HOUR_MS; if (timestamp < window.localStart || timestamp >= window.localEnd) continue;
      const icon = WEATHER_ICON.exec(row)?.[1] ?? ""; const rainMm = numberOrNull(WEATHER_RAIN.exec(row)?.[1]); const temp = numberOrNull(WEATHER_TEMP.exec(row)?.[1]);
      const explicitPop = numberOrNull(WEATHER_POP.exec(row)?.[1] ?? WEATHER_POP_TEXT.exec(stripHtml(row))?.[1]);
      const pop = explicitPop ?? (rainMm !== null && rainMm > 0 ? 100 : icon.startsWith("3") ? 60 : 10); const key = String(hour);
      if (!Object.prototype.hasOwnProperty.call(hourly, key)) hourlyCount += 1;
      hourly[key] = { pop: Math.max(0, Math.min(100, pop)), rainMm, temp, humidity: null, icon };
    }
  }
  WEATHER_GROUP.lastIndex = 0; WEATHER_ROW.lastIndex = 0;
  if (hourlyCount !== WEATHER_WINDOW_HOURS) throw new Error(`WeatherNews provided ${hourlyCount} of ${WEATHER_WINDOW_HOURS} rolling hourly rows`);
  return { forecastDate: window.forecastDate, startHour: window.startHour, windowStartAt: window.windowStartAt, hourly };
}
function jsonRecord(value: unknown): JsonRecord | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null; }
function weatherNewsField(record: JsonRecord, name: string): unknown { for (const [key, value] of Object.entries(record)) if (key.trim() === name) return value; return undefined; }
function weatherNewsCoordinates(rawUrl: string): { lat: number; lon: number } | null {
  try { const url = new URL(rawUrl); const pathMatch = WEATHERNEWS_COORDINATES.exec(url.pathname);
    const lat = numberOrNull(pathMatch?.[1] ?? url.searchParams.get("lat") ?? url.searchParams.get("slat"));
    const lon = numberOrNull(pathMatch?.[2] ?? url.searchParams.get("lon") ?? url.searchParams.get("slon"));
    return lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180 ? null : { lat, lon }; } catch { return null; }
}
function weatherNewsTimestampMs(value: unknown): number | null { const numeric = numberOrNull(value); if (numeric !== null) return Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric; if (typeof value !== "string") return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function weatherNewsIcon(value: unknown): string { const numeric = numberOrNull(value); if (numeric === null) return ""; const rounded = Math.trunc(numeric); return rounded >= 0 && rounded <= 999 ? String(rounded) : ""; }
function weatherNewsRainProbability(icon: string, rainMm: number | null, explicitPop: number | null): number { if (explicitPop !== null) return Math.max(0, Math.min(100, explicitPop)); if (rainMm !== null && rainMm > 0) return 100; return icon === "300" || icon === "650" || icon === "850" ? 60 : 10; }
function parseWeatherNewsCurrent(payload: unknown, now = new Date()): WeatherForecast {
  const root = jsonRecord(payload); const rows = root ? weatherNewsField(root, "srf") : null; if (!Array.isArray(rows)) throw new Error("WeatherNews current hourly data was not found");
  const window = weatherWindow(now); const hourly: Record<string, unknown> = {};
  for (const value of rows) { const row = jsonRecord(value); if (!row) continue; const timestamp = weatherNewsTimestampMs(weatherNewsField(row, "tm")); if (timestamp === null || timestamp < window.actualStart || timestamp >= window.actualEnd) continue;
    const hour = new Date(timestamp + JST_MS).getUTCHours(); const key = String(hour); if (Object.prototype.hasOwnProperty.call(hourly, key)) continue;
    const icon = weatherNewsIcon(weatherNewsField(row, "WX")); const rainMm = numberOrNull(weatherNewsField(row, "PREC")); const temp = numberOrNull(weatherNewsField(row, "AIRTMP")); const humidity = numberOrNull(weatherNewsField(row, "RHUM")); const explicitPop = numberOrNull(weatherNewsField(row, "POP"));
    hourly[key] = { pop: weatherNewsRainProbability(icon, rainMm, explicitPop), rainMm, temp, humidity, icon }; }
  const hourlyCount = Object.keys(hourly).length; if (hourlyCount !== WEATHER_WINDOW_HOURS) throw new Error(`WeatherNews current data provided ${hourlyCount} of ${WEATHER_WINDOW_HOURS} rolling hourly rows`);
  return { forecastDate: window.forecastDate, startHour: window.startHour, windowStartAt: window.windowStartAt, hourly };
}
export async function fetchWeather(env: Env): Promise<SourceResult> {
  const now = new Date(); const url = env.WEATHERNEWS_URL?.trim(); if (!url) throw new Error("WEATHERNEWS_URL is not configured");
  const coordinates = weatherNewsCoordinates(url); let forecast: WeatherForecast;
  if (coordinates) { const endpoint = new URL(WEATHERNEWS_CURRENT_ENDPOINT); endpoint.searchParams.set("lat", String(coordinates.lat)); endpoint.searchParams.set("lon", String(coordinates.lon)); endpoint.searchParams.set("tm", String(Math.floor(now.getTime() / 1000))); forecast = parseWeatherNewsCurrent(await fetchJson<unknown>(endpoint.toString()), now); }
  else forecast = parseWeatherNews(await fetchText(url), now);
  return { source: "weather", payload: { city: env.CITY_NAME?.trim() || "Configured location", ...forecast, generatedAt: now.toISOString() }, observedAt: now.getTime() };
}
