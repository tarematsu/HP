import { describe, expect, it } from "vitest";
import type { Env } from "../src/sources";
import {
  extractSpotifyEpisodeUrls,
  normalizeSpotifyEpisodeUrl,
  normalizeSpotifyShowUrl,
  resolveLatestSpotifyTalkAboutEpisode,
} from "../src/spotify_talkabout_latest";

const SHOW_ID = "2ZQy2mlwQodabAILwZ02Ed";
const OLD_EPISODE = "AAAAAAAAAAAAAAAAAAAAAA";
const NEW_EPISODE = "BBBBBBBBBBBBBBBBBBBBBB";

describe("Spotify TALKABOUT latest episode resolver", () => {
  it("accepts only direct open.spotify.com show and episode routes", () => {
    expect(normalizeSpotifyShowUrl(`https://open.spotify.com/show/${SHOW_ID}`))
      .toBe(`https://open.spotify.com/show/${SHOW_ID}`);
    expect(normalizeSpotifyEpisodeUrl(`https://open.spotify.com/episode/${NEW_EPISODE}`))
      .toBe(`https://open.spotify.com/episode/${NEW_EPISODE}`);
    expect(normalizeSpotifyShowUrl(`https://open.spotify.com.evil/show/${SHOW_ID}`)).toBe("");
    expect(normalizeSpotifyEpisodeUrl("https://example.com/episode/BBBBBBBBBBBBBBBBBBBBBB")).toBe("");
  });

  it("extracts direct episode URLs from escaped Spotify HTML in source order", () => {
    const html = `first \\u002fepisode\\u002f${NEW_EPISODE} then https:\\/\\/open.spotify.com\\/episode\\/${OLD_EPISODE}`;
    expect(extractSpotifyEpisodeUrls(html)).toEqual([
      `https://open.spotify.com/episode/${NEW_EPISODE}`,
      `https://open.spotify.com/episode/${OLD_EPISODE}`,
    ]);
  });

  it("uses Spotify Web API and selects the newest release date", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("accounts.spotify.com/api/token")) {
        return Response.json({ access_token: "test-token", expires_in: 3600 });
      }
      if (url.includes(`/v1/shows/${SHOW_ID}/episodes`)) {
        return Response.json({
          items: [
            { id: OLD_EPISODE, release_date: "2026-09-01" },
            { id: NEW_EPISODE, release_date: "2026-09-10" },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const env = {
      SPOTIFY_CLIENT_ID: "talkabout-test-client",
      SPOTIFY_CLIENT_SECRET: "talkabout-test-secret",
    } as Env;

    await expect(resolveLatestSpotifyTalkAboutEpisode(
      env,
      `https://open.spotify.com/show/${SHOW_ID}`,
      { fetchImpl, now: Date.UTC(2026, 8, 11) },
    )).resolves.toBe(`https://open.spotify.com/episode/${NEW_EPISODE}`);
    expect(calls.some((url) => url.includes("accounts.spotify.com/api/token"))).toBe(true);
    expect(calls.some((url) => url.includes(`/v1/shows/${SHOW_ID}/episodes`))).toBe(true);
  });

  it("falls back to public show HTML when client credentials are unavailable", async () => {
    const fetchImpl = (async () => new Response(
      `<a href="/episode/${NEW_EPISODE}">latest</a><a href="/episode/${OLD_EPISODE}">old</a>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as typeof fetch;

    await expect(resolveLatestSpotifyTalkAboutEpisode(
      {} as Env,
      `https://open.spotify.com/show/${SHOW_ID}`,
      { fetchImpl, now: Date.UTC(2026, 8, 11) },
    )).resolves.toBe(`https://open.spotify.com/episode/${NEW_EPISODE}`);
  });

  it("returns empty for an invalid configured show instead of guessing", async () => {
    await expect(resolveLatestSpotifyTalkAboutEpisode(
      {} as Env,
      "https://example.com/show/not-spotify",
    )).resolves.toBe("");
  });
});
