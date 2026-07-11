import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeather } from "../src/sources";
import type { Env } from "../src/sources";

const baseEnv = {
  DB: {} as D1Database,
  CITY_NAME: "Kawagoe",
  WEATHERNEWS_URL: "https://example.invalid/weathernews",
} satisfies Env;

function row(hour: number, icon: string, options: { rainMm?: number; pop?: number } = {}): string {
  const popCell = options.pop !== undefined ? `<div class="wTable__item p">${options.pop}</div>` : "";
  const rainCell = options.rainMm !== undefined ? `<div class="wTable__item r">${options.rainMm}</div>` : "";
  return `<div class="wTable__row">` +
    `<div class="wTable__item time">${hour}</div>` +
    `<div class="wTable__item t">25</div>` +
    `${rainCell}` +
    `${popCell}` +
    `<img src="/img/wxicon/${icon}.png">` +
    `</div>`;
}

function group(day: number, rows: string[]): string {
  return `<div class="wTable__group"><div class="wTable__item">${day}日</div>${rows.join("")}</div>`;
}

function weatherNewsHtml(day1: { day: number; rows: string[] }, day2: { day: number; rows: string[] }): string {
  return `<div id="flick_list">` +
    `<div class="wTable day1">${group(day1.day, day1.rows)}</div>` +
    `<div class="wTable day2">${group(day2.day, day2.rows)}</div>` +
    `</div>`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WeatherNews hourly parsing", () => {
  it("reads tomorrow's forecast from the day2 table late at night instead of failing", async () => {
    vi.useFakeTimers();
    // 2026-07-11T14:34:00Z is 2026-07-11 23:34 JST, so the target is tomorrow (7/12).
    vi.setSystemTime(new Date("2026-07-11T14:34:00Z"));
    const html = weatherNewsHtml(
      { day: 11, rows: [row(5, "100", { rainMm: 0, pop: 10 })] },
      { day: 12, rows: [row(5, "100", { rainMm: 0, pop: 20 }), row(6, "100", { rainMm: 0, pop: 30 })] },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));

    const result = await fetchWeather(baseEnv);
    const payload = result.payload as { forecastDate: string; hourly: Record<string, { pop: number }> };

    expect(payload.forecastDate).toBe("7/12");
    expect(payload.hourly["5"]!.pop).toBe(20);
    expect(payload.hourly["6"]!.pop).toBe(30);
  });

  it("does not fabricate a rain probability for a cloudy icon", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T20:00:00Z")); // 05:00 JST, target is today
    const html = weatherNewsHtml(
      { day: 12, rows: [row(5, "201", { rainMm: 0 })] }, // cloudy icon, no explicit pop
      { day: 13, rows: [] },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));

    const result = await fetchWeather(baseEnv);
    const payload = result.payload as { hourly: Record<string, { pop: number }> };

    expect(payload.hourly["5"]!.pop).toBe(10);
  });

  it("still infers a wet probability for a rain icon when none is given explicitly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T20:00:00Z")); // 05:00 JST, target is today
    const html = weatherNewsHtml(
      { day: 12, rows: [row(5, "300", { rainMm: 0 })] }, // rain icon, no explicit pop
      { day: 13, rows: [] },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));

    const result = await fetchWeather(baseEnv);
    const payload = result.payload as { hourly: Record<string, { pop: number }> };

    expect(payload.hourly["5"]!.pop).toBe(60);
  });
});
