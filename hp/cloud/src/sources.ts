import { fetchNews } from "./news_source";
import { fetchOctopus } from "./octopus_source";
import { fetchRadar } from "./radar_source";
import { fetchStationhead } from "./spotify_source";
import type { Env, SourceResult } from "./source_types";
import { fetchWeather } from "./weather_source";

export type { Env, SourceResult, StateStatus } from "./source_types";
export { JST_MS, jstDayKey } from "./source_types";
export { fetchNews } from "./news_source";
export { fetchWeather } from "./weather_source";

export async function executeSource(name: string, env: Env): Promise<SourceResult> {
  switch (name) {
    case "weather": return fetchWeather(env);
    case "news": return fetchNews();
    case "octopus": return fetchOctopus(env);
    case "stationhead": return fetchStationhead(env);
    case "radar": return fetchRadar(env);
    default: throw new Error(`Unknown job: ${name}`);
  }
}
