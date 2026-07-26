import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeather } from "../src/sources";
import type { Env } from "../src/sources";

const env = {
  DB: {} as D1Database,
  CITY_NAME: "Kawagoe",
  WEATHERNEWS_URL: "https://weathernews.jp/onebox/35.8524/139.4852/",
} satisfies Env;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WeatherNews outage handling", () => {
  it("does not fall back to the legacy page when the current API is unavailable", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      requestedUrls.push(request.url);
      return new Response("unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWeather(env)).rejects.toThrow("503 Service Unavailable");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls.every(url => new URL(url).origin === "https://site.weathernews.jp")).toBe(true);
    expect(requestedUrls.some(url => url.includes("/onebox/"))).toBe(false);
  });
});
