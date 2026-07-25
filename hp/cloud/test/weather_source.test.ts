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
  it("reads the current forecast hour and the following eleven hours", async () => {
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

    expect(payload.forecastDate).toBe("7/11〜7/12");
    expect(payload.startHour).toBe(23);
    expect(payload.windowStartAt).toBe("2026-07-11T14:00:00.000Z");
    expect(Object.keys(payload.hourly)).toHaveLength(12);
    expect(payload.hourly["22"]).toBeUndefined();
    expect(payload.hourly["23"]!.pop).toBe(20);
    expect(payload.hourly["0"]!.pop).toBe(30);
    expect(payload.hourly["10"]!.pop).toBe(40);
    expect(payload.hourly["11"]).toBeUndefined();
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

  it("keeps the stable window marker within the hour and advances it at the next hour", async () => {
    vi.useFakeTimers();
    const html = weatherNewsHtml(
      { day: 12, rows: Array.from({ length: 18 }, (_, hour) => row(hour, "100", { rainMm: 0, pop: 10 })) },
      { day: 13, rows: [] },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));

    vi.setSystemTime(new Date("2026-07-11T20:00:00Z")); // 05:00 JST
    const first = await fetchWeather(baseEnv);
    vi.setSystemTime(new Date("2026-07-11T20:59:00Z")); // 05:59 JST
    const sameHour = await fetchWeather(baseEnv);
    vi.setSystemTime(new Date("2026-07-11T21:00:00Z")); // 06:00 JST
    const nextHour = await fetchWeather(baseEnv);

    expect((first.payload as { windowStartAt: string }).windowStartAt)
      .toBe("2026-07-11T20:00:00.000Z");
    expect((sameHour.payload as { windowStartAt: string }).windowStartAt)
      .toBe("2026-07-11T20:00:00.000Z");
    expect((nextHour.payload as { windowStartAt: string }).windowStartAt)
      .toBe("2026-07-11T21:00:00.000Z");
  });

  it("resolves the rolling window across a year boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T14:34:00Z")); // 2026-12-31 23:34 JST
    const html = weatherNewsHtml(
      { day: 31, rows: [row(23, "100", { rainMm: 0, pop: 20 })] },
      { day: 1, rows: Array.from({ length: 12 }, (_, hour) => row(hour, "100", { rainMm: 0, pop: 30 })) },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));

    const result = await fetchWeather(baseEnv);
    const payload = result.payload as {
      forecastDate: string;
      startHour: number;
      windowStartAt: string;
      hourly: Record<string, unknown>;
    };

    expect(payload.forecastDate).toBe("12/31〜1/1");
    expect(payload.startHour).toBe(23);
    expect(payload.windowStartAt).toBe("2026-12-31T14:00:00.000Z");
    expect(Object.keys(payload.hourly)).toHaveLength(12);
    expect(payload.hourly["23"]).toBeDefined();
    expect(payload.hourly["10"]).toBeDefined();
    expect(payload.hourly["11"]).toBeUndefined();
  });
});
