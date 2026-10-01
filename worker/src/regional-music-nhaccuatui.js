import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { visibleHtmlText } from './regional-music-html.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const NHACCUATUI_ORIGIN = 'https://www.nhaccuatui.com';

export const NHACCUATUI_SEEDS = Object.freeze({
  sakurazaka46: Object.freeze({
    id: 'a0qQaCjo4LuZ',
    title: 'Isshun No Uma',
    url: 'https://www.nhaccuatui.com/song/a0qQaCjo4LuZ',
  }),
  hinatazaka46: Object.freeze({
    id: '1mZO8IyQ1c4s',
    title: 'One Choice',
    url: 'https://www.nhaccuatui.com/song/1mZO8IyQ1c4s',
  }),
  nogizaka46: Object.freeze({
    id: 'Be2uz8tZNdmu',
    title: 'Ima Hanashitai Darekagairu',
    url: 'https://www.nhaccuatui.com/bai-hat/ima-hanashitai-darekagairu-nogizaka46.Be2uz8tZNdmu.html',
  }),
});

function normalizeArtistName(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

function number(value) {
  if (!value) return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

export function parseNhacCuaTuiMetrics(html, artistName) {
  const text = visibleHtmlText(html);
  const escaped = String(artistName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const followerMatch = text.match(new RegExp(`${escaped}\\s+([0-9][0-9,]*)\\s+followers?`, 'i'));
  const playMatch = text.match(/(?:^|\s)([0-9][0-9,]*)\s+Play(?:\s|$)/i);
  return {
    followers: number(followerMatch?.[1]),
    plays: number(playMatch?.[1]),
  };
}

export function findNhacCuaTuiArtistHref(html, artistName) {
  const source = String(html || '');
  const anchors = source.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  const wanted = normalizeArtistName(artistName);
  for (const match of anchors) {
    if (!/nghe-si|artist/i.test(match[1])) continue;
    if (normalizeArtistName(visibleHtmlText(match[2])) === wanted) return match[1];
  }
  return null;
}

export function absoluteNhacCuaTuiUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, NHACCUATUI_ORIGIN).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function collectNhacCuaTui(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let collected = 0;

  for (const [canonicalArtist, seed] of Object.entries(NHACCUATUI_SEEDS)) {
    const artistName = REGIONAL_MUSIC_ARTISTS[canonicalArtist].aliases[1];
    try {
      const html = await fetchHtml(fetchImpl, seed.url);
      const metrics = parseNhacCuaTuiMetrics(html, artistName);
      const artistHref = findNhacCuaTuiArtistHref(html, artistName);
      const profileUrl = absoluteNhacCuaTuiUrl(artistHref) || seed.url;
      const serviceArtistId = profileUrl !== seed.url ? profileUrl : `name:${artistName}`;

      await saveRegionalArtist(env, {
        service: 'nhaccuatui',
        canonical_artist: canonicalArtist,
        service_artist_id: serviceArtistId,
        display_name: artistName,
        profile_url: profileUrl,
        followers: metrics.followers,
        observed_at: observedAt,
      });
      await saveRegionalTrack(env, {
        service: 'nhaccuatui',
        service_track_id: seed.id,
        service_artist_id: serviceArtistId,
        canonical_artist: canonicalArtist,
        title: seed.title,
        track_url: seed.url,
        plays: metrics.plays,
        observed_at: observedAt,
      });
      collected += 1;
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : collected ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'nhaccuatui',
    status,
    last_attempt_at: observedAt,
    last_success_at: collected ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists: collected, tracks: collected, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'nhaccuatui', status, artists: collected, tracks: collected, failures };
}
