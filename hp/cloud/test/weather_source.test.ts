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

function sameDayWindow(
  startHour: number,
  selectedHour: number,
  icon: string,
  options: { rainMm?: number; pop?: number } = {},
): string[] {
  return Array.from({ length: 12 }, (_, offset) => {
    const hour = startHour + offset;
    return hour === selectedHour ? row(hour, icon, options) : row(hour, "100", { rainMm: 0, pop: 10 });
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WeatherNews hourly parsing", () => {
  it("reads the next 12 complete forecast hours from the next clock boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T14:34:00Z")); // 2026-07-11 23:34 JST
    const html = weatherNewsHtml(
      {
        day: 11,
        rows: [
          row(22, "100", { rainMm: 0, pop: 5 }),
          row(23, "100", { rainMm: 0, pop: 20 }),
        ],
      },
      {
        day: 12,
        rows: [
          ...Array.from({ length: 12 }, (_, hour) => row(hour, "100", { rainMm: 0, pop: 30 + hour })),
          row(12, "100", { rainMm: 0, pop: 90 }),
        ],
      },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));

    const result = await fetchWeather(baseEnv);
    const payload = result.payload as {
      forecastDate: string;
      startHour: number;
      windowStartAt: string;
      hourly: Record<string, { pop: number }>;
    };

    expect(payload.forecastDate).toBe("7/12");
    expect(payload.startHour).toBe(0);
    expect(payload.windowStartAt).toBe("2026-07-11T15:00:00.000Z");
    expect(Object.keys(payload.hourly)).toHaveLength(12);
    expect(payload.hourly["23"]).toBeUndefined();
    expect(payload.hourly["0"]!.pop).toBe(30);
    expect(payload.hourly["11"]!.pop).toBe(41);
    expect(payload.hourly["12"]).toBeUndefined();
  });

  it("does not fabricate a rain probability for a cloudy icon", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T20:00:00Z")); // 2026-07-12 05:00 JST
    const html = weatherNewsHtml(
      { day: 12, rows: sameDayWindow(5, 5, "201", { rainMm: 0 }) },
      { day: 13, rows: [] },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));

    const result = await fetchWeather(baseEnv);
    const payload = result.payload as { hourly: Record<string, { pop: number }> };

    expect(payload.hourly["5"]!.pop).toBe(10);
  });

  it("still infers a wet probability for a rain icon when none is given explicitly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T20:00:00Z")); // 2026-07-12 05:00 JST
    const html = weatherNewsHtml(
      { day: 12, rows: sameDayWindow(5, 5, "300", { rainMm: 0 }) },
      { day: 13, rows: [] },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));

    const result = await fetchWeather(baseEnv);
    const payload = result.payload as { hourly: Record<string, { pop: number }> };

    expect(payload.hourly["5"]!.pop).toBe(60);
  });

  it("changes the stable window marker when the forecast advances by an hour", async () => {
    vi.useFakeTimers();
    const html = weatherNewsHtml(
      { day: 12, rows: Array.from({ length: 18 }, (_, hour) => row(hour, "100", { rainMm: 0, pop: 10 })) },
      { day: 13, rows: [] },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));

    vi.setSystemTime(new Date("2026-07-11T20:00:00Z")); // 05:00 JST
    const first = await fetchWeather(baseEnv);
    vi.setSystemTime(new Date("2026-07-11T20:01:00Z")); // 05:01 JST -> 06:00 window
    const second = await fetchWeather(baseEnv);

    expect((first.payload as { windowStartAt: string }).windowStartAt)
      .toBe("2026-07-11T20:00:00.000Z");
    expect((second.payload as { windowStartAt: string }).windowStartAt)
      .toBe("2026-07-11T21:00:00.000Z");
  });
});
